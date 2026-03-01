import { ChatwootMessageType, LogLevel, MessageStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ChatwootClient } from "../../providers/chatwoot/client";
import { getChatwootConfig } from "../../services/runtimeConfig";
import { consumeApp } from "../../services/superAdminApp";
import { systemLog } from "../../services/systemLog";
import { syncChatwootAttributesForCustomer } from "../../services/chatwootSync";

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
    }).catch(() => {});
    await systemLog(LogLevel.WARN, "chatwoot.send", "Cliente sin teléfono", {
      chatwootMessageId,
      customerId: msg.customerId
    }).catch(() => {});
    return;
  }

  const cfg = await getChatwootConfig();
  if (!cfg.configured) {
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: "chatwoot not configured" }
    });
    await systemLog(LogLevel.WARN, "chatwoot.send", "Chatwoot no configurado", {
      chatwootMessageId,
      customerId: msg.customerId
    }).catch(() => {});
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

  const customerMeta: any = (msg.customer.metadata ?? {}) as any;
  const knownContactId = customerMeta?.chatwoot?.contactId;
  const knownSourceId = customerMeta?.chatwoot?.sourceId;
  if (typeof knownContactId === "number" && Number.isFinite(knownContactId)) {
    contactId = knownContactId;
    if (typeof knownSourceId === "string" && knownSourceId.trim()) sourceId = knownSourceId.trim();
  }

  try {
    if (!contactId) {
      const created = await client.createContact({
        name: msg.customer.name || undefined,
        email: msg.customer.email || undefined,
        phoneNumber: msg.customer.phone || undefined
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
        data: { metadata: merged as any }
      }).catch(() => {});
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
        data: { metadata: merged as any }
      }).catch(() => {});
      break;
    }
  }

  if (!contactId) {
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: "contact not found/created" }
    });
    await systemLog(LogLevel.WARN, "chatwoot.send", "Contacto no encontrado/creado", {
      chatwootMessageId,
      customerId: msg.customerId
    }).catch(() => {});
    return;
  }

  if (!sourceId) {
    try {
      const contactInfo = await client.getContact(contactId);
      sourceId = contactInfo.sourceId;
    } catch {
      // ignore
    }
  }
  if (!sourceId) {
    try {
      const createdInbox = await client.createContactInbox(contactId);
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
        data: { metadata: merged as any }
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  await syncChatwootAttributesForCustomer(msg.customerId).catch(() => {});

  const meta: any = (msg.subscription?.metadata ?? {}) as any;
  const existingConversationId = meta?.chatwoot?.conversationId;
  let conversationId: number;
  if (typeof existingConversationId === "number") {
    conversationId = existingConversationId;
  } else {
    try {
      conversationId = (await client.createConversation({ contactId, sourceId, message: undefined })).conversationId;
    } catch (err: any) {
      const message = err?.message ? String(err.message) : "chatwoot_create_conversation_failed";
      await prisma.chatwootMessage.update({
        where: { id: chatwootMessageId },
        data: { status: MessageStatus.FAILED, errorMessage: message }
      }).catch(() => {});
      await systemLog(LogLevel.ERROR, "chatwoot.send", "Error creando conversación", {
        chatwootMessageId,
        customerId: msg.customerId,
        err: message
      }).catch(() => {});
      return;
    }
  }

  if (typeof existingConversationId !== "number" && msg.subscriptionId) {
    const merged = {
      ...(meta || {}),
      chatwoot: { ...(meta?.chatwoot || {}), conversationId, contactId }
    };
    await prisma.subscription.update({
      where: { id: msg.subscriptionId },
      data: { metadata: merged as any }
    });
  }

  const templateParams = (msg.providerResp as any)?.template_params;
  const attachmentUrl = (msg.providerResp as any)?.attachment?.url;
  let allowTemplate = Boolean(templateParams);
  if (templateParams) {
    try {
      const inbox = await client.getInbox(cfg.inboxId);
      const channelType = String((inbox.raw as any)?.channel_type || "");
      const medium = String((inbox.raw as any)?.medium || "");
      const provider = String((inbox.raw as any)?.provider || "");
      const isWhatsapp = /whatsapp/i.test(channelType) || /whatsapp/i.test(medium) || /whatsapp/i.test(provider);
      allowTemplate = isWhatsapp;
      if (!isWhatsapp) {
        await systemLog(LogLevel.INFO, "chatwoot.send", "Template omitido: canal no WhatsApp", {
          chatwootMessageId,
          customerId: msg.customerId,
          channelType,
          medium,
          provider
        }).catch(() => {});
      }
    } catch {
      allowTemplate = false;
    }
  }
  let sent: any;
  try {
    if (allowTemplate && templateParams) {
      sent = await client.sendTemplate(conversationId, { content: msg.content, templateParams });
    } else if (attachmentUrl) {
      const attachment = await downloadAttachment(attachmentUrl);
      const content = stripAttachmentLine(msg.content, attachmentUrl);
      sent = await client.sendMessageWithAttachment(conversationId, content || msg.content, {
        buffer: attachment.buffer,
        mime: attachment.mime,
        filename: `producto.${attachment.ext}`
      });
    } else {
      sent = await client.sendMessage(conversationId, msg.content);
    }
  } catch (err: any) {
    const message = err?.message ? String(err.message) : "chatwoot_send_failed";
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: message }
    }).catch(() => {});
    await systemLog(LogLevel.ERROR, "chatwoot.send", "Error enviando mensaje", {
      chatwootMessageId,
      customerId: msg.customerId,
      err: message
    }).catch(() => {});
    throw err;
  }

  await prisma.chatwootMessage.update({
    where: { id: chatwootMessageId },
    data: {
      status: MessageStatus.SENT,
      sentAt: new Date(),
      providerResp: templateParams ? ({ ...(msg.providerResp as any), response: sent.raw } as any) : (sent.raw as any),
      errorMessage: null
    }
  });

  await consumeApp("messages_sent", { amount: 1, source: "jobs:chatwoot.sent", meta: { type: msg.type, id: msg.id } });
  if (msg.type === ChatwootMessageType.PAYMENT_LINK) {
    await consumeApp("payment_links_sent", { amount: 1, source: "jobs:chatwoot.sent", meta: { chatwootMessageId: msg.id } });
  }

  await systemLog(LogLevel.INFO, "chatwoot.send", "Mensaje enviado", {
    chatwootMessageId,
    customerId: msg.customerId,
    type: msg.type
  }).catch(() => {});
}
