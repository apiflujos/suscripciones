import { LogLevel } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ChatwootClient } from "../providers/chatwoot/client";
import { getChatwootConfig } from "./runtimeConfig";
import { systemLog } from "./systemLog";

export async function ensureChatwootContactForCustomer(customerId: string) {
  const id = String(customerId || "").trim();
  if (!id) return { ok: false as const, reason: "missing_customer_id" as const };

  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return { ok: false as const, reason: "customer_not_found" as const };

  const cfg = await getChatwootConfig();
  if (!cfg.configured) return { ok: false as const, reason: "chatwoot_not_configured" as const };

  const meta: any = (customer.metadata ?? {}) as any;
  const existingContactId = meta?.chatwoot?.contactId;
  const existingSourceId = meta?.chatwoot?.sourceId;

  if (typeof existingContactId === "number" && Number.isFinite(existingContactId)) {
    return { ok: true as const, contactId: existingContactId, sourceId: existingSourceId };
  }

  const client = new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });

  let created: Awaited<ReturnType<ChatwootClient["createContact"]>> | null = null;
  try {
    created = await client.createContact({
      name: customer.name || undefined,
      email: customer.email || undefined,
      phoneNumber: customer.phone || undefined
    });
  } catch (err: any) {
    // If contact exists already, we can at least try to search by email/phone.
    const q = customer.email || customer.phone || "";
    if (q) {
      const found = await client.searchContact(q).catch(() => null);
      if (found?.contactId) {
        const merged = {
          ...(meta && typeof meta === "object" ? meta : {}),
          chatwoot: { ...(meta?.chatwoot || {}), contactId: found.contactId }
        };
        await prisma.customer.update({ where: { id: customer.id }, data: { metadata: merged as any } }).catch(() => {});
        return { ok: true as const, contactId: found.contactId, sourceId: existingSourceId };
      }
    }
    await systemLog(LogLevel.WARN, "chatwoot.sync", "Could not create/search contact for customer", {
      customerId: customer.id,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    return { ok: false as const, reason: "create_or_search_failed" as const };
  }

  if (!created?.contactId) return { ok: false as const, reason: "create_failed" as const };

  const merged = {
    ...(meta && typeof meta === "object" ? meta : {}),
    chatwoot: { ...(meta?.chatwoot || {}), contactId: created.contactId, sourceId: created.sourceId }
  };
  await prisma.customer.update({ where: { id: customer.id }, data: { metadata: merged as any } }).catch(() => {});

  return { ok: true as const, contactId: created.contactId, sourceId: created.sourceId };
}

export async function syncChatwootAttributesForCustomer(customerId: string) {
  const id = String(customerId || "").trim();
  if (!id) return { ok: false as const, reason: "missing_customer_id" as const };

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      subscriptions: {
        include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" }
      },
      payments: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!customer) return { ok: false as const, reason: "customer_not_found" as const };

  const cfg = await getChatwootConfig();
  if (!cfg.configured) return { ok: false as const, reason: "chatwoot_not_configured" as const };

  const ensured = await ensureChatwootContactForCustomer(customer.id);
  if (!ensured.ok) return ensured;

  const sub = customer.subscriptions?.[0] || null;
  const latestPayment = customer.payments?.[0] || sub?.payments?.[0] || null;
  const currentPeriodEndAt = sub?.currentPeriodEndAt ? new Date(sub.currentPeriodEndAt) : null;
  const now = Date.now();
  const daysPastDue =
    currentPeriodEndAt && currentPeriodEndAt.getTime() < now
      ? Math.floor((now - currentPeriodEndAt.getTime()) / 86_400_000)
      : 0;

  const customAttributes = {
    subscription_status: sub?.status ?? null,
    plan_name: sub?.plan?.name ?? null,
    plan_price: sub?.plan?.priceInCents ?? null,
    next_billing_date: currentPeriodEndAt ? currentPeriodEndAt.toISOString() : null,
    last_payment_status: latestPayment?.status ?? null,
    last_payment_date: latestPayment?.createdAt ? new Date(latestPayment.createdAt).toISOString() : null,
    days_past_due: daysPastDue,
    in_mora: sub?.status === "PAST_DUE" || daysPastDue > 0
  } as any;

  const client = new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });

  await client.updateContact(ensured.contactId, {
    name: customer.name || undefined,
    email: customer.email || undefined,
    phoneNumber: customer.phone || undefined,
    customAttributes
  });

  return { ok: true as const };
}
