import { MessageStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ChatwootClient } from "../../providers/chatwoot/client";
import { getChatwootConfig } from "../../services/runtimeConfig";

export async function sendChatwootMessage(chatwootMessageId: string) {
  const msg = await prisma.chatwootMessage.findUnique({
    where: { id: chatwootMessageId },
    include: { customer: true, subscription: true }
  });
  if (!msg) return;
  if (msg.status === MessageStatus.SENT) return;

  const cfg = await getChatwootConfig();
  if (!cfg.configured) {
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: "chatwoot not configured" }
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
        chatwoot: { ...(customerMeta?.chatwoot || {}), contactId, sourceId }
      };
      await prisma.customer.update({
        where: { id: msg.customerId },
        data: { metadata: merged as any }
      }).catch(() => {});
    }
  } catch {
    const q = msg.customer.email || msg.customer.phone || "";
    if (q) {
      const found = await client.searchContact(q);
      contactId = found?.contactId;
      if (contactId) {
        const merged = {
          ...(customerMeta && typeof customerMeta === "object" ? customerMeta : {}),
          chatwoot: { ...(customerMeta?.chatwoot || {}), contactId }
        };
        await prisma.customer.update({
          where: { id: msg.customerId },
          data: { metadata: merged as any }
        }).catch(() => {});
      }
    }
  }

  if (!contactId) {
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: "contact not found/created" }
    });
    return;
  }

  const meta: any = (msg.subscription?.metadata ?? {}) as any;
  const existingConversationId = meta?.chatwoot?.conversationId;
  const conversationId =
    typeof existingConversationId === "number"
      ? existingConversationId
      : (await client.createConversation({ contactId, sourceId, message: undefined })).conversationId;

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
  const sent = templateParams
    ? await client.sendTemplate(conversationId, { content: msg.content, templateParams })
    : await client.sendMessage(conversationId, msg.content);

  await prisma.chatwootMessage.update({
    where: { id: chatwootMessageId },
    data: {
      status: MessageStatus.SENT,
      sentAt: new Date(),
      providerResp: templateParams ? ({ ...(msg.providerResp as any), response: sent.raw } as any) : (sent.raw as any),
      errorMessage: null
    }
  });
}
