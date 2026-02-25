import { LogLevel } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ChatwootClient } from "../providers/chatwoot/client";
import { getChatwootConfig } from "./runtimeConfig";
import { systemLog } from "./systemLog";

const CUSTOM_ATTR_DEFS: Array<{
  key: string;
  displayName: string;
  displayType: "text" | "number" | "currency" | "boolean" | "url" | "date" | "list" | "percent" | "checkbox";
  values?: string[];
}> = [
  { key: "subscription_status", displayName: "Subscription Status", displayType: "list", values: ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"] },
  { key: "plan_name", displayName: "Plan Name", displayType: "text" },
  { key: "plan_price", displayName: "Plan Price (cents)", displayType: "number" },
  { key: "next_billing_date", displayName: "Next Billing Date", displayType: "date" },
  { key: "last_payment_status", displayName: "Last Payment Status", displayType: "list", values: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"] },
  { key: "last_payment_date", displayName: "Last Payment Date", displayType: "date" },
  { key: "days_past_due", displayName: "Days Past Due", displayType: "number" },
  { key: "in_mora", displayName: "In Mora", displayType: "boolean" }
];

let lastEnsureAt = 0;
let lastEnsureOk = false;

async function ensureCustomAttributes(client: ChatwootClient) {
  const now = Date.now();
  if (lastEnsureOk && now - lastEnsureAt < 10 * 60 * 1000) return { ok: true as const };
  lastEnsureAt = now;

  try {
    const list = await client.listCustomAttributes("contact");
    const existing = new Set(
      Array.isArray(list.raw?.payload)
        ? (list.raw.payload as any[]).map((a) => String(a?.attribute_key || a?.attributeKey || ""))
        : []
    );
    for (const def of CUSTOM_ATTR_DEFS) {
      if (existing.has(def.key)) continue;
      await client.createCustomAttribute({ ...def, model: "contact" });
    }
    lastEnsureOk = true;
    return { ok: true as const };
  } catch (err: any) {
    lastEnsureOk = false;
    await systemLog(LogLevel.WARN, "chatwoot.sync", "No se pudieron asegurar atributos", {
      err: err?.message ? String(err.message) : "unknown_error"
    }).catch(() => {});
    return { ok: false as const };
  }
}

export async function ensureChatwootCustomAttributes() {
  const cfg = await getChatwootConfig();
  if (!cfg.configured) return { ok: false as const, reason: "chatwoot_not_configured" as const };
  const client = new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });
  return ensureCustomAttributes(client);
}

export async function ensureChatwootContactForCustomer(customerId: string) {
  const id = String(customerId || "").trim();
  if (!id) return { ok: false as const, reason: "missing_customer_id" as const };

  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return { ok: false as const, reason: "customer_not_found" as const };

  const cfg = await getChatwootConfig();
  if (!cfg.configured) {
    await systemLog(LogLevel.WARN, "chatwoot.sync", "Chatwoot no configurado", { customerId: customer.id }).catch(() => {});
    return { ok: false as const, reason: "chatwoot_not_configured" as const };
  }

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

  await ensureCustomAttributes(client);

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

  await ensureCustomAttributes(client);

  await client.updateContact(ensured.contactId, {
    name: customer.name || undefined,
    email: customer.email || undefined,
    phoneNumber: customer.phone || undefined,
    customAttributes
  });

  return { ok: true as const };
}
