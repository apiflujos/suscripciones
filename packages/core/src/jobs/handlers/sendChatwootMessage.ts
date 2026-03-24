import { ChatwootMessageType, LogLevel, MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ChatwootClient } from "../../providers/chatwoot/client";
import { getChatwootConfig } from "../../services/runtimeConfig";
import { consumeApp } from "../../services/superAdminApp";
import { systemLog } from "../../services/systemLog";
import { syncChatwootAttributesForCustomer } from "../../services/chatwootSync";
import { logger } from "../../lib/logger";

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

async function downloadAttachment(url: string) {
  const safeUrl = String(url || "").trim();
  if (!/^https?:\/\//i.test(safeUrl)) throw new Error("attachment_url_invalid");
  const res = await fetch(safeUrl);
  if (!res.ok) throw new Error("attachment_download_failed");
  const contentType = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength && contentLength > MAX_ATTACHMENT_BYTES) throw new Error("attachment_too_large");
  if (!contentType.startsWith("image/")) throw new Error("attachment_not_image");
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error("attachment_too_large");
  const ext = MIME_EXT[contentType] || "png";
  return { buffer, mime: contentType || "application/octet-stream", ext };
}

function stripAttachmentLine(content: string, url: string) {
  const safe = String(content || "");
  const target = String(url || "").trim();
  if (!target) return safe;
  const lines = safe.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith("Imagen:")) return false;
    if (trimmed.includes(target)) return false;
    return true;
  });
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeInlineImages(content: string) {
  const safe = String(content || "");
  const lines = safe.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^imagen\s*:/i.test(trimmed)) return false;
    if (/data:image\//i.test(trimmed)) return false;
    return true;
  });
  const out = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || safe.trim();
}

type ContactableInboxMeta = {
  inboxId?: number;
  sourceId?: string;
  channelType?: string;
  medium?: string;
  provider?: string;
};

type ContactableInboxRaw = {
  payload?: unknown;
};

function toContactableInboxes(raw: ContactableInboxRaw | unknown): ContactableInboxMeta[] {
  const payload = raw && typeof raw === "object" && Array.isArray((raw as ContactableInboxRaw).payload)
    ? ((raw as ContactableInboxRaw).payload as unknown[])
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  return payload
    .map((item: any) => {
      const inbox = item?.inbox || item?.inbox_meta || item?.inboxMeta || {};
      const inboxIdRaw = inbox?.id ?? item?.inbox_id ?? item?.inboxId;
      const inboxId = Number(inboxIdRaw);
      return {
        inboxId: Number.isFinite(inboxId) ? inboxId : undefined,
        sourceId: String(item?.source_id || item?.sourceId || "").trim() || undefined,
        channelType: String(inbox?.channel_type || item?.channel_type || "").trim() || undefined,
        medium: String(inbox?.medium || item?.medium || "").trim() || undefined,
        provider: String(inbox?.provider || item?.provider || "").trim() || undefined
      };
    })
    .filter((item: ContactableInboxMeta) => item.inboxId || item.sourceId);
}

function isWhatsappChannel(meta: { channelType?: string; medium?: string; provider?: string }) {
  const channelType = String(meta?.channelType || "");
  const medium = String(meta?.medium || "");
  const provider = String(meta?.provider || "");
  return /whatsapp/i.test(channelType) || /whatsapp/i.test(medium) || /whatsapp/i.test(provider);
}

export async function sendChatwootMessage(chatwootMessageId: string) {
  const msg = await prisma.chatwootMessage.findUnique({
    where: { id: chatwootMessageId },
    include: { customer: true, subscription: true }
  });
  if (!msg) return;
  if (msg.status === MessageStatus.SENT) return;
  if (!msg.customer?.phone) {
    const errorMessage = "customer_phone_required";
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage }
    }).catch((err) => {
      logger.warn({ err, chatwootMessageId }, "chatwoot.send: failed to update message status");
    });
    await systemLog(LogLevel.WARN, "chatwoot.send", "Cliente sin teléfono", {
      actor: "job:sendChatwootMessage",
      chatwootMessageId,
      customerId: msg.customerId
    }).catch((err) => {
      logger.warn({ err, chatwootMessageId }, "chatwoot.send: failed to write system log");
    });
    return;
  }

  const cfg = await getChatwootConfig();
  if (!cfg.configured) {
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: "chatwoot not configured" }
    });
    await systemLog(LogLevel.WARN, "chatwoot.send", "Chatwoot no configurado", {
      actor: "job:sendChatwootMessage",
      chatwootMessageId,
      customerId: msg.customerId
    }).catch((err) => {
      logger.warn({ err, chatwootMessageId }, "chatwoot.send: failed to write system log");
    });
    return;
  }

  const client = new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });

  // Ensure contact + conversation
  let contactId: number | undefined;
  let sourceId: string | undefined;
  let selectedInboxId: number | undefined;
  let selectedChannel: ContactableInboxMeta | null = null;
  let contactableInboxes: ContactableInboxMeta[] = [];

  type CustomerMetadata = Record<string, unknown> & {
    chatwoot?: { contactId?: number; sourceId?: string; contactSnapshot?: { name?: string | null; email?: string | null; phone?: string | null } };
  };
  const customerMeta = (msg.customer.metadata ?? {}) as CustomerMetadata;
  const knownContactId = customerMeta?.chatwoot?.contactId;
  const knownSourceId = customerMeta?.chatwoot?.sourceId;
  if (typeof knownContactId === "number" && Number.isFinite(knownContactId)) {
    contactId = knownContactId;
    if (typeof knownSourceId === "string" && knownSourceId.trim()) sourceId = knownSourceId.trim();
  }

  try {
    if (!contactId) {
      const name = String(msg.customer.name || "").trim();
      const email = String(msg.customer.email || "").trim();
      const phone = String(msg.customer.phone || "").trim();
      if (!name || !email || !phone) {
        await prisma.chatwootMessage.update({
          where: { id: chatwootMessageId },
          data: { status: MessageStatus.FAILED, errorMessage: "missing_customer_fields" }
        });
        await systemLog(LogLevel.WARN, "chatwoot.send", "Contacto no creado: faltan nombre/email/teléfono", {
          actor: "job:sendChatwootMessage",
          chatwootMessageId,
          customerId: msg.customerId,
          hasName: Boolean(name),
          hasEmail: Boolean(email),
          hasPhone: Boolean(phone)
        }).catch((err) => {
          logger.warn({ err, chatwootMessageId }, "chatwoot.send: failed to write system log");
        });
        return;
      }

      const created = await client.createContact({
        name,
        email,
        phoneNumber: phone
      });
      contactId = created.contactId;
      sourceId = created.sourceId;

      const merged = {
        ...(customerMeta && typeof customerMeta === "object" ? customerMeta : {}),
        chatwoot: {
          ...(customerMeta?.chatwoot || {}),
          contactId,
          sourceId,
          contactSnapshot: { name: msg.customer.name ?? null, email: msg.customer.email ?? null, phone: msg.customer.phone ?? null }
        }
      };
      await prisma.customer.update({
        where: { id: msg.customerId },
        data: { metadata: merged as Prisma.InputJsonValue }
      }).catch((err) => {
        logger.warn({ err, customerId: msg.customerId }, "chatwoot.send: failed to update customer metadata");
      });
    }
  } catch {
    const queries = client.buildSearchQueries({
      email: msg.customer.email || undefined,
      phoneNumber: msg.customer.phone || undefined
    });
    for (const q of queries) {
      const found = await client.searchContact(q).catch(() => null);
      contactId = found?.contactId;
      if (!contactId) continue;
      let fetchedSourceId: string | undefined;
      try {
        const contactInfo = await client.getContact(contactId);
        fetchedSourceId = contactInfo.sourceId;
      } catch {
        // ignore
      }
      if (!fetchedSourceId) {
        try {
          const createdInbox = await client.createContactInbox(contactId);
          fetchedSourceId = createdInbox.sourceId;
        } catch {
          // ignore
        }
      }
      sourceId = fetchedSourceId || sourceId;
      const merged = {
        ...(customerMeta && typeof customerMeta === "object" ? customerMeta : {}),
        chatwoot: {
          ...(customerMeta?.chatwoot || {}),
          contactId,
          sourceId,
          contactSnapshot: { name: msg.customer.name ?? null, email: msg.customer.email ?? null, phone: msg.customer.phone ?? null }
        }
      };
      await prisma.customer.update({
        where: { id: msg.customerId },
        data: { metadata: merged as Prisma.InputJsonValue }
      }).catch((err) => {
        logger.warn({ err, customerId: msg.customerId }, "chatwoot.send: failed to update customer metadata");
      });
      break;
    }
  }

  if (!contactId) {
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: "contact not found/created" }
    });
    await systemLog(LogLevel.WARN, "chatwoot.send", "Contacto no encontrado/creado", {
      actor: "job:sendChatwootMessage",
      chatwootMessageId,
      customerId: msg.customerId
    }).catch((err) => {
      logger.warn({ err, chatwootMessageId }, "chatwoot.send: failed to write system log");
    });
    return;
  }

  type ProviderResp = {
    template_params?: Record<string, unknown>;
    attachment?: { url?: string };
    inboxId?: number | string;
    inbox_id?: number | string;
  };
  const providerResp = (msg.providerResp ?? {}) as ProviderResp;
  const templateParams = providerResp?.template_params;
  const attachmentUrl = providerResp?.attachment?.url;
  const requestedInboxRaw = providerResp?.inboxId ?? providerResp?.inbox_id;
  const requestedInboxId = Number(requestedInboxRaw);
  const hasRequestedInbox = Number.isFinite(requestedInboxId);
  const wantsTemplate = Boolean(templateParams);
  try {
    const contactable = await client.listContactableInboxes(contactId);
    contactableInboxes = toContactableInboxes(contactable.raw);
  } catch (err) {
    logger.warn({ err, contactId }, "chatwoot.send: failed to list contactable inboxes");
    contactableInboxes = [];
  }

  if (contactableInboxes.length) {
    let byRequested = hasRequestedInbox
      ? contactableInboxes.find((item) => item.inboxId === requestedInboxId)
      : null;
    if (!byRequested && hasRequestedInbox) {
      try {
        const createdInbox = await client.createContactInbox(contactId, undefined, requestedInboxId);
        byRequested = { inboxId: requestedInboxId, sourceId: createdInbox.sourceId };
        contactableInboxes = [...contactableInboxes, byRequested];
      } catch {
        // ignore
      }
    }
    const byTemplate = wantsTemplate ? contactableInboxes.find((item) => isWhatsappChannel(item)) : null;
    const byConfig = contactableInboxes.find((item) => item.inboxId === cfg.inboxId);
    const prefer = byRequested || byTemplate || byConfig || contactableInboxes[0];
    selectedInboxId = prefer?.inboxId;
    selectedChannel = prefer || null;
    if (!sourceId && prefer?.sourceId) sourceId = prefer.sourceId;
  } else if (hasRequestedInbox) {
    selectedInboxId = requestedInboxId;
  }

  if (!sourceId) {
    try {
      const contactInfo = await client.getContact(contactId, selectedInboxId ?? cfg.inboxId);
      sourceId = contactInfo.sourceId;
    } catch {
      // ignore
    }
  }
  if (!sourceId) {
    try {
      const createdInbox = await client.createContactInbox(contactId, undefined, selectedInboxId ?? cfg.inboxId);
      sourceId = createdInbox.sourceId;
      const merged = {
        ...(customerMeta && typeof customerMeta === "object" ? customerMeta : {}),
        chatwoot: {
          ...(customerMeta?.chatwoot || {}),
          contactId,
          sourceId,
          contactSnapshot: { name: msg.customer.name ?? null, email: msg.customer.email ?? null, phone: msg.customer.phone ?? null }
        }
      };
      await prisma.customer.update({
        where: { id: msg.customerId },
        data: { metadata: merged as Prisma.InputJsonValue }
      }).catch((err) => {
        logger.warn({ err, customerId: msg.customerId }, "chatwoot.send: failed to update customer metadata");
      });
    } catch {
      // ignore
    }
  }

  await syncChatwootAttributesForCustomer(msg.customerId).catch((err) => {
    logger.warn({ err, customerId: msg.customerId }, "chatwoot.send: failed to sync chatwoot attributes");
  });

  type SubscriptionMetadata = Record<string, unknown> & { chatwoot?: { conversationId?: number } };
  const meta = (msg.subscription?.metadata ?? {}) as SubscriptionMetadata;
  const existingConversationId = meta?.chatwoot?.conversationId;
  let conversationId: number | undefined;
  if (typeof existingConversationId === "number") {
    conversationId = existingConversationId;
  } else {
    try {
      conversationId = (
        await client.createConversation({ contactId, sourceId, inboxId: selectedInboxId ?? cfg.inboxId, message: undefined })
      ).conversationId;
    } catch (err: any) {
      const message = err?.message ? String(err.message) : "chatwoot_create_conversation_failed";
      const isNotFound = /resource could not be found/i.test(message);
      const canRetryInbox = !!selectedInboxId && selectedInboxId !== cfg.inboxId && isNotFound;
      if (canRetryInbox) {
        try {
          conversationId = (await client.createConversation({ contactId, sourceId, inboxId: cfg.inboxId, message: undefined })).conversationId;
        } catch {
          // fall through to re-create contact
        }
      }
      if (!conversationId && isNotFound) {
        try {
          const cleanedMeta =
            customerMeta && typeof customerMeta === "object" ? ({ ...customerMeta, chatwoot: undefined } as Record<string, unknown>) : customerMeta;
          if (cleanedMeta && typeof cleanedMeta === "object") {
            await prisma.customer
              .update({
                where: { id: msg.customerId },
                data: { metadata: cleanedMeta as Prisma.InputJsonValue }
              })
              .catch((updateErr) => {
                logger.warn({ err: updateErr, customerId: msg.customerId }, "chatwoot.send: failed to clear customer metadata");
              });
          }
          const name = String(msg.customer.name || "").trim();
          const email = String(msg.customer.email || "").trim();
          const phone = String(msg.customer.phone || "").trim();
          if (!name || !email || !phone) {
            throw new Error("missing_customer_fields");
          }
          const recreated = await client.createContact({ name, email, phoneNumber: phone });
          contactId = recreated.contactId;
          sourceId = recreated.sourceId;
          const merged = {
            ...(customerMeta && typeof customerMeta === "object" ? customerMeta : {}),
            chatwoot: {
              contactId,
              sourceId,
              contactSnapshot: { name: msg.customer.name ?? null, email: msg.customer.email ?? null, phone: msg.customer.phone ?? null }
            }
          };
          await prisma.customer.update({
            where: { id: msg.customerId },
            data: { metadata: merged as Prisma.InputJsonValue }
          }).catch((updateErr) => {
            logger.warn({ err: updateErr, customerId: msg.customerId }, "chatwoot.send: failed to update customer metadata");
          });
          conversationId = (
            await client.createConversation({ contactId, sourceId, inboxId: selectedInboxId ?? cfg.inboxId, message: undefined })
          ).conversationId;
        } catch (recreateErr: any) {
          const retryMessage = recreateErr?.message ? String(recreateErr.message) : message;
          await prisma.chatwootMessage.update({
            where: { id: chatwootMessageId },
            data: { status: MessageStatus.FAILED, errorMessage: retryMessage }
          }).catch((updateErr) => {
            logger.warn({ err: updateErr, chatwootMessageId }, "chatwoot.send: failed to update message status");
          });
          await systemLog(LogLevel.ERROR, "chatwoot.send", "Error creando conversación", {
            actor: "job:sendChatwootMessage",
            chatwootMessageId,
            customerId: msg.customerId,
            err: retryMessage
          }).catch((logErr) => {
            logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
          });
          return;
        }
      } else {
        await prisma.chatwootMessage.update({
          where: { id: chatwootMessageId },
          data: { status: MessageStatus.FAILED, errorMessage: message }
        }).catch((updateErr) => {
          logger.warn({ err: updateErr, chatwootMessageId }, "chatwoot.send: failed to update message status");
        });
        await systemLog(LogLevel.ERROR, "chatwoot.send", "Error creando conversación", {
          actor: "job:sendChatwootMessage",
          chatwootMessageId,
          customerId: msg.customerId,
          err: message
        }).catch((logErr) => {
          logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
        });
        return;
      }
    }
  }

  if (typeof conversationId !== "number") {
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: "chatwoot_conversation_missing" }
    }).catch((updateErr) => {
      logger.warn({ err: updateErr, chatwootMessageId }, "chatwoot.send: failed to update message status");
    });
    await systemLog(LogLevel.ERROR, "chatwoot.send", "Conversación no disponible", {
      actor: "job:sendChatwootMessage",
      chatwootMessageId,
      customerId: msg.customerId
    }).catch((logErr) => {
      logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
    });
    return;
  }

  if (typeof existingConversationId !== "number" && msg.subscriptionId) {
    const merged = {
      ...(meta || {}),
      chatwoot: { ...(meta?.chatwoot || {}), conversationId, contactId }
    };
    await prisma.subscription.update({
      where: { id: msg.subscriptionId },
      data: { metadata: merged as Prisma.InputJsonValue }
    }).catch((err) => {
      logger.warn({ err, subscriptionId: msg.subscriptionId }, "chatwoot.send: failed to update subscription metadata");
    });
  }

  let allowTemplate = Boolean(templateParams);
  if (templateParams) {
    try {
      let channelType = selectedChannel?.channelType || "";
      let medium = selectedChannel?.medium || "";
      let provider = selectedChannel?.provider || "";
      if (!channelType && !medium && !provider) {
        const inbox = await client.getInbox(selectedInboxId ?? cfg.inboxId);
        const raw = inbox.raw as { channel_type?: string; medium?: string; provider?: string } | undefined;
        channelType = String(raw?.channel_type || "");
        medium = String(raw?.medium || "");
        provider = String(raw?.provider || "");
      }
      const isWhatsapp = isWhatsappChannel({ channelType, medium, provider });
      allowTemplate = isWhatsapp;
      if (!isWhatsapp) {
        await systemLog(LogLevel.INFO, "chatwoot.send", "Template omitido: canal no WhatsApp", {
          actor: "job:sendChatwootMessage",
          chatwootMessageId,
          customerId: msg.customerId,
          channelType,
          medium,
          provider
        }).catch((logErr) => {
          logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
        });
      }
    } catch {
      allowTemplate = false;
    }
  }
  let sent: any;
  try {
    if (allowTemplate && templateParams) {
      try {
        sent = await client.sendTemplate(conversationId, { content: sanitizeInlineImages(msg.content), templateParams });
      } catch (err: any) {
        const errMsg = String(err?.message || "");
        if (/content[_-]?type/i.test(errMsg) && /html/i.test(errMsg)) {
          sent = await client.sendMessage(conversationId, sanitizeInlineImages(msg.content));
        } else {
          throw err;
        }
      }
    } else if (attachmentUrl) {
      try {
        const attachment = await downloadAttachment(attachmentUrl);
        const content = sanitizeInlineImages(stripAttachmentLine(msg.content, attachmentUrl));
        sent = await client.sendMessageWithAttachment(conversationId, content || sanitizeInlineImages(msg.content), {
          buffer: attachment.buffer,
          mime: attachment.mime,
          filename: `producto.${attachment.ext}`
        });
      } catch (err: any) {
        await systemLog(LogLevel.WARN, "chatwoot.send", "Adjunto falló; enviando solo texto", {
          actor: "job:sendChatwootMessage",
          chatwootMessageId,
          customerId: msg.customerId,
          err: String(err?.message || err || "attachment_failed")
        }).catch((logErr) => {
          logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
        });
        const content = sanitizeInlineImages(stripAttachmentLine(msg.content, attachmentUrl));
        sent = await client.sendMessage(conversationId, content || sanitizeInlineImages(msg.content));
      }
    } else {
      sent = await client.sendMessage(conversationId, sanitizeInlineImages(msg.content));
    }
  } catch (err: any) {
    const message = err?.message ? String(err.message) : "chatwoot_send_failed";
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: message }
    }).catch((updateErr) => {
      logger.warn({ err: updateErr, chatwootMessageId }, "chatwoot.send: failed to update message status");
    });
    await systemLog(LogLevel.ERROR, "chatwoot.send", "Error enviando mensaje", {
      actor: "job:sendChatwootMessage",
      chatwootMessageId,
      customerId: msg.customerId,
      err: message
    }).catch((logErr) => {
      logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
    });
    throw err;
  }

  await prisma.chatwootMessage.update({
    where: { id: chatwootMessageId },
    data: {
      status: MessageStatus.SENT,
      sentAt: new Date(),
      providerResp: templateParams
        ? ({ ...(msg.providerResp as Record<string, unknown>), response: sent.raw } as Prisma.InputJsonValue)
        : (sent.raw as Prisma.InputJsonValue),
      errorMessage: null
    }
  });

  const nowIso = new Date().toISOString();
  const nextMeta = {
    ...(customerMeta && typeof customerMeta === "object" ? customerMeta : {}),
    chatwoot: {
      ...(customerMeta?.chatwoot || {}),
      contactId,
      sourceId,
      lastOutgoingAt: nowIso,
      lastConversationId: conversationId
    }
  };
  await prisma.customer.update({
    where: { id: msg.customerId },
    data: { metadata: nextMeta as Prisma.InputJsonValue }
  }).catch((err) => {
    logger.warn({ err, customerId: msg.customerId }, "chatwoot.send: failed to update customer metadata");
  });

  await consumeApp("messages_sent", { amount: 1, source: "jobs:chatwoot.sent", meta: { type: msg.type, id: msg.id } });
  if (msg.type === ChatwootMessageType.PAYMENT_LINK) {
    await consumeApp("payment_links_sent", { amount: 1, source: "jobs:chatwoot.sent", meta: { chatwootMessageId: msg.id } });
  }

}
