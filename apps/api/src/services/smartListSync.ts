import { prisma } from "../db/prisma";
import { computeSmartListRecipients } from "./smartList";
import { ChatwootClient } from "../providers/chatwoot/client";
import { getChatwootConfig } from "./runtimeConfig";
import { ensureChatwootContactForCustomer } from "./chatwootSync";

async function getClient() {
  const cfg = await getChatwootConfig();
  if (!cfg.configured) throw new Error("chatwoot_not_configured");
  return new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });
}

export async function syncSmartListById(id: string) {
  const smartList = await prisma.smartList.findUnique({ where: { id } });
  if (!smartList || !smartList.enabled) return { ok: false as const, reason: "not_found_or_disabled" as const };

  const recipients = await computeSmartListRecipients(smartList.rules as any);
  const recipientIds = new Set(recipients.map((r) => r.id));

  const client = await getClient();

  let added = 0;
  let removed = 0;

  for (const customer of recipients) {
    const ensured = await ensureChatwootContactForCustomer(customer.id).catch(() => null);
    if (!ensured?.ok) continue;
    await client.addContactLabels(ensured.contactId, [smartList.chatwootLabel]).catch(() => {});
    await prisma.smartListMember.upsert({
      where: { smartListId_customerId: { smartListId: smartList.id, customerId: customer.id } },
      create: { smartListId: smartList.id, customerId: customer.id, active: true, lastSeenAt: new Date() },
      update: { active: true, lastSeenAt: new Date() }
    });
    added += 1;
  }

  const currentMembers = await prisma.smartListMember.findMany({
    where: { smartListId: smartList.id, active: true }
  });

  for (const member of currentMembers) {
    if (recipientIds.has(member.customerId)) continue;
    const customer = await prisma.customer.findUnique({ where: { id: member.customerId } });
    const meta: any = (customer?.metadata ?? {}) as any;
    const contactId = meta?.chatwoot?.contactId;
    if (typeof contactId === "number" && Number.isFinite(contactId)) {
      await client.removeContactLabels(contactId, [smartList.chatwootLabel]).catch(() => {});
    }
    await prisma.smartListMember.update({
      where: { id: member.id },
      data: { active: false }
    });
    removed += 1;
  }

  await prisma.smartList.update({ where: { id: smartList.id }, data: { lastRunAt: new Date() } });
  return { ok: true as const, added, removed };
}

export async function syncAllSmartLists() {
  const lists = await prisma.smartList.findMany({ where: { enabled: true } });
  const results: Array<{ id: string; added: number; removed: number; ok: boolean }> = [];
  for (const list of lists) {
    const out = await syncSmartListById(list.id).catch(() => null);
    if (out?.ok) {
      results.push({ id: list.id, added: out.added, removed: out.removed, ok: true });
    } else {
      results.push({ id: list.id, added: 0, removed: 0, ok: false });
    }
  }
  return results;
}
