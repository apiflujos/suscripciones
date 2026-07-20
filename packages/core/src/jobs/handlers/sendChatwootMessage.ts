import { ChatwootMessageType, LogLevel, MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ChatwootClient } from "../../providers/chatwoot/client";
import { reconcileChatwootMessageDelivery } from "../../services/chatwootDelivery";
import { getChatwootConfig } from "../../services/runtimeConfig";
import { consumeApp } from "../../services/superAdminApp";
import { systemLog } from "../../services/systemLog";
import { ensureChatwootContactForCustomer, syncChatwootAttributesForCustomer } from "../../services/chatwootSync";
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

  if (!contactId) {
    const ensured = await ensureChatwootContactForCustomer(msg.customerId);
    if (ensured.ok) {
      contactId = ensured.contactId;
      sourceId = ensured.sourceId;
    } else {
      const errorMessage =
        ensured.reason === "customer_phone_required"
          ? "customer_phone_required"
          : ensured.reason === "chatwoot_not_configured"
            ? "chatwoot_not_configured"
            : ensured.reason === "customer_not_found"
              ? "customer_not_found"
              : ensured.reason === "missing_customer_id"
                ? "missing_customer_id"
                : ensured.reason === "create_or_search_failed"
                  ? "contact not found/created"
                  : "contact not found/created";
      await prisma.chatwootMessage.update({
        where: { id: chatwootMessageId },
        data: { status: MessageStatus.FAILED, errorMessage }
      });
      await systemLog(LogLevel.WARN, "chatwoot.send", "No se pudo crear o encontrar el contacto en Chatwoot", {
        actor: "job:sendChatwootMessage",
        chatwootMessageId,
        customerId: msg.customerId,
        reason: ensured.reason,
        detail: "detail" in ensured ? (ensured as any).detail : null,
        searchQueries: "searchQueries" in ensured ? (ensured as any).searchQueries : [],
        customerPhone: msg.customer.phone || null
      }).catch((err) => {
        logger.warn({ err, chatwootMessageId }, "chatwoot.send: failed to write system log");
      });
      return;
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
  } else if (wantsTemplate && cfg.inboxId) {
    // Contacto sin inboxes contactables todavía (recibe su PRIMER mensaje de WhatsApp).
    // Caemos al inbox de WhatsApp configurado para que createContactInbox()/getContact()
    // de abajo creen el source_id. La validación getInbox() en el bloque de plantilla
    // confirma que ese inbox sea realmente WhatsApp (si no, falla con whatsapp_channel_required).
    selectedInboxId = cfg.inboxId;
  }

  // selectedChannel may have no channelType/medium/provider if Chatwoot's contactable-inboxes API
  // omits that metadata. The secondary check below calls getInbox() for a fresh authoritative read,
  // so here we only fail when no inbox was selected at all.
  if (wantsTemplate && !selectedInboxId) {
    const errorMessage = "whatsapp_inbox_required";
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage }
    }).catch((updateErr) => {
      logger.warn({ err: updateErr, chatwootMessageId }, "chatwoot.send: failed to update message status");
    });
    await systemLog(LogLevel.WARN, "chatwoot.send", "Plantilla WhatsApp omitida: inbox WhatsApp no disponible", {
      actor: "job:sendChatwootMessage",
      chatwootMessageId,
      customerId: msg.customerId,
      requestedInboxId: hasRequestedInbox ? requestedInboxId : null,
      configuredInboxId: cfg.inboxId,
      contactId
    }).catch((err) => {
      logger.warn({ err, chatwootMessageId }, "chatwoot.send: failed to write system log");
    });
    return;
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
        await prisma.chatwootMessage.update({
          where: { id: chatwootMessageId },
          data: { status: MessageStatus.FAILED, errorMessage: "whatsapp_channel_required" }
        }).catch((updateErr) => {
          logger.warn({ err: updateErr, chatwootMessageId }, "chatwoot.send: failed to update message status");
        });
        await systemLog(LogLevel.WARN, "chatwoot.send", "Template omitido: canal no WhatsApp", {
          actor: "job:sendChatwootMessage",
          chatwootMessageId,
          customerId: msg.customerId,
          channelType,
          medium,
          provider
        }).catch((logErr) => {
          logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
        });
        return;
      }
    } catch {
      allowTemplate = false;
      await prisma.chatwootMessage.update({
        where: { id: chatwootMessageId },
        data: { status: MessageStatus.FAILED, errorMessage: "whatsapp_channel_lookup_failed" }
      }).catch((updateErr) => {
        logger.warn({ err: updateErr, chatwootMessageId }, "chatwoot.send: failed to update message status");
      });
      await systemLog(LogLevel.WARN, "chatwoot.send", "No se pudo validar canal WhatsApp para template", {
        actor: "job:sendChatwootMessage",
        chatwootMessageId,
        customerId: msg.customerId
      }).catch((logErr) => {
        logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
      });
      return;
    }
  }
  const doSend = async (convId: number) => {
    if (allowTemplate && templateParams) {
      return client.sendTemplate(convId, { content: sanitizeInlineImages(msg.content), templateParams });
    }
    if (attachmentUrl) {
      try {
        const attachment = await downloadAttachment(attachmentUrl);
        const content = sanitizeInlineImages(stripAttachmentLine(msg.content, attachmentUrl));
        return client.sendMessageWithAttachment(convId, content || sanitizeInlineImages(msg.content), {
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
        return client.sendMessage(convId, content || sanitizeInlineImages(msg.content));
      }
    }
    return client.sendMessage(convId, sanitizeInlineImages(msg.content));
  };

  let sent: any;
  try {
    sent = await doSend(conversationId);
  } catch (err: any) {
    const message = err?.message ? String(err.message) : "chatwoot_send_failed";
    const isStaleConversation =
      typeof existingConversationId === "number" &&
      conversationId === existingConversationId &&
      /resource could not be found/i.test(message);

    if (isStaleConversation && msg.subscriptionId) {
      // Clear the stale conversationId from subscription metadata and retry with a new conversation
      const cleanedSubMeta = { ...(meta || {}), chatwoot: { ...(meta?.chatwoot || {}), conversationId: undefined } };
      delete (cleanedSubMeta.chatwoot as Record<string, unknown>).conversationId;
      await prisma.subscription.update({
        where: { id: msg.subscriptionId },
        data: { metadata: cleanedSubMeta as Prisma.InputJsonValue }
      }).catch((updateErr) => {
        logger.warn({ err: updateErr, subscriptionId: msg.subscriptionId }, "chatwoot.send: failed to clear stale conversationId");
      });

      try {
        const fresh = await client.createConversation({ contactId, sourceId, inboxId: selectedInboxId ?? cfg.inboxId, message: undefined });
        conversationId = fresh.conversationId;
        sent = await doSend(conversationId);
        const refreshedSubMeta = {
          ...(cleanedSubMeta || {}),
          chatwoot: { ...(cleanedSubMeta?.chatwoot || {}), conversationId, contactId }
        };
        await prisma.subscription.update({
          where: { id: msg.subscriptionId! },
          data: { metadata: refreshedSubMeta as Prisma.InputJsonValue }
        }).catch((updateErr) => {
          logger.warn({ err: updateErr, subscriptionId: msg.subscriptionId }, "chatwoot.send: failed to save new conversationId after recovery");
        });
        await systemLog(LogLevel.WARN, "chatwoot.send", "Conversacion obsoleta recreada y mensaje enviado", {
          actor: "job:sendChatwootMessage",
          chatwootMessageId,
          customerId: msg.customerId,
          staleConversationId: existingConversationId,
          newConversationId: conversationId
        }).catch((logErr) => {
          logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
        });
      } catch (retryErr: any) {
        const retryMessage = retryErr?.message ? String(retryErr.message) : message;
        await prisma.chatwootMessage.update({
          where: { id: chatwootMessageId },
          data: { status: MessageStatus.FAILED, errorMessage: retryMessage }
        }).catch((updateErr) => {
          logger.warn({ err: updateErr, chatwootMessageId }, "chatwoot.send: failed to update message status");
        });
        await systemLog(LogLevel.ERROR, "chatwoot.send", "Error enviando mensaje tras recrear conversacion", {
          actor: "job:sendChatwootMessage",
          chatwootMessageId,
          customerId: msg.customerId,
          err: retryMessage
        }).catch((logErr) => {
          logger.warn({ err: logErr, chatwootMessageId }, "chatwoot.send: failed to write system log");
        });
        throw retryErr;
      }
    } else {
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
  }

  await prisma.chatwootMessage.update({
    where: { id: chatwootMessageId },
    data: {
      status: MessageStatus.PENDING,
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

  const delivery = await reconcileChatwootMessageDelivery({
    chatwootMessageId,
    actor: "job:sendChatwootMessage",
    attempts: 4,
    waitMs: 1500
  }).catch((err: any) => ({
    ok: false as const,
    reason: err?.message ? String(err.message) : "chatwoot_delivery_lookup_failed"
  }));

  if (!delivery.ok) {
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: {
        status: MessageStatus.PENDING,
        errorMessage: delivery.reason
      }
    }).catch((err) => {
      logger.warn({ err, chatwootMessageId }, "chatwoot.send: failed to persist fallback pending state");
    });
    await systemLog(LogLevel.WARN, "chatwoot.send", "No se pudo reconciliar entrega real en Chatwoot", {
      actor: "job:sendChatwootMessage",
      chatwootMessageId,
      customerId: msg.customerId,
      reason: delivery.reason
    }).catch((err) => {
      logger.warn({ err, chatwootMessageId }, "chatwoot.send: failed to write delivery reconciliation log");
    });
  }

  if (delivery.ok ? delivery.state === "delivered" || delivery.state === "submitted" : false) {
    await consumeApp("messages_sent", { amount: 1, source: "jobs:chatwoot.sent", meta: { type: msg.type, id: msg.id } });
    if (msg.type === ChatwootMessageType.PAYMENT_LINK) {
      await consumeApp("payment_links_sent", { amount: 1, source: "jobs:chatwoot.sent", meta: { chatwootMessageId: msg.id } });
    }
  }
}
