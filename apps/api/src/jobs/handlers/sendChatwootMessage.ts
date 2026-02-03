import { MessageStatus } from "@prisma/client";
import { loadEnv } from "../../config/env";
import { prisma } from "../../db/prisma";
import { ChatwootClient } from "../../providers/chatwoot/client";

export async function sendChatwootMessage(chatwootMessageId: string) {
  const env = loadEnv(process.env);

  const msg = await prisma.chatwootMessage.findUnique({
    where: { id: chatwootMessageId },
    include: { customer: true, subscription: true }
  });
  if (!msg) return;
  if (msg.status === MessageStatus.SENT) return;

  if (!env.CHATWOOT_BASE_URL || !env.CHATWOOT_API_ACCESS_TOKEN || !env.CHATWOOT_ACCOUNT_ID || !env.CHATWOOT_INBOX_ID) {
    await prisma.chatwootMessage.update({
      where: { id: chatwootMessageId },
      data: { status: MessageStatus.FAILED, errorMessage: "chatwoot not configured" }
    });
    return;
  }

  const client = new ChatwootClient({
    baseUrl: env.CHATWOOT_BASE_URL,
    accountId: env.CHATWOOT_ACCOUNT_ID,
    apiAccessToken: env.CHATWOOT_API_ACCESS_TOKEN,
    inboxId: env.CHATWOOT_INBOX_ID
  });

  // Ensure contact + conversation
  let contactId: number | undefined;
  let sourceId: string | undefined;
  try {
    const created = await client.createContact({
      name: msg.customer.name || undefined,
      email: msg.customer.email || undefined,
      phoneNumber: msg.customer.phone || undefined
    });
    contactId = created.contactId;
    sourceId = created.sourceId;
  } catch {
    const q = msg.customer.email || msg.customer.phone || "";
    if (q) {
      const found = await client.searchContact(q);
      contactId = found?.contactId;
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

  const sent = await client.sendMessage(conversationId, msg.content);

  await prisma.chatwootMessage.update({
    where: { id: chatwootMessageId },
    data: {
      status: MessageStatus.SENT,
      sentAt: new Date(),
      providerResp: sent.raw as any,
      errorMessage: null
    }
  });
}

