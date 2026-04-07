import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { systemLog } from "../../services/systemLog";
import { BillingCycleStatus, GamificationEntityType, LogLevel, PaymentAssociationReason, Prisma, type Subscription } from "@prisma/client";
import { classifyReference } from "../../webhooks/wompi/classifyReference";
import { postJson } from "../../lib/http";
import { PaymentLinkStatus, PaymentStatus, SubscriptionStatus, WebhookProcessStatus } from "@prisma/client";
import { addIntervalUtc } from "../../lib/dates";
import { getPaymentsConfig, getShopifyForward, getWompiCheckoutLinkBaseUrl } from "../../services/runtimeConfig";
import { schedulePaymentStatusNotifications, scheduleSubscriptionDueNotifications } from "../../services/notificationsScheduler";
import { consumeApp } from "../../services/superAdminApp";
import { syncChatwootAttributesForCustomer } from "../../services/chatwootSync";
import { getDefaultTenantId } from "../../services/tenantContext";
import { applyGamificationEvent, GAMIFICATION_EVENT_KINDS } from "../../services/gamification";
import { GAMIFICATION_WEIGHTS, moneyToPoints } from "../../services/gamificationConfig";
import { resolveSubscriptionCollectionMode } from "../../services/subscriptionMode";
import { publishRealtime } from "../../services/realtimePublisher";
import { ensurePaymentRetryJob } from "../../services/retryJobScheduler";
import { attachPaymentToCycle, attachPaymentToMatchingCycle, computeBillingCycleDueAt, ensureBillingCyclesForSubscriptions } from "../../services/billingCycles";
import { getSubscriptionPricingTotal, getPlanCollectionMode } from "../../lib/metadataSchemas";

type WompiCustomerData = {
  full_name?: string;
  name?: string;
  fullName?: string;
  email?: string;
  phone_number?: string;
  phoneNumber?: string;
};

type WompiCustomer = {
  name?: string;
  phone_number?: string;
  phone?: string;
};

type WompiPaymentLinkRef = {
  id?: string;
  permalink?: string;
  checkout_url?: string;
  checkoutUrl?: string;
};

type WompiTransaction = {
  id?: string;
  reference?: string;
  payment_link_id?: string;
  paymentLinkId?: string;
  payment_link?: WompiPaymentLinkRef;
  paymentLink?: WompiPaymentLinkRef;
  status?: string;
  status_message?: string;
  statusMessage?: string;
  amount_in_cents?: number;
  amountInCents?: number;
  currency?: string;
  customer_email?: string;
  customerEmail?: string;
  customer_data?: WompiCustomerData;
  customer?: WompiCustomer;
  finalized_at?: string | number;
  finalizedAt?: string | number;
  created_at?: string | number;
  createdAt?: string | number;
  paid_at?: string | number;
  paidAt?: string | number;
};

type WompiPayload = {
  data?: {
    transaction?: WompiTransaction;
    customer_email?: string;
    customerEmail?: string;
  };
  signature?: { checksum?: string };
  event?: string;
  timestamp?: string | number;
};

function getTransactionFromPayload(payload: WompiPayload): WompiTransaction | null {
  const tx = payload?.data?.transaction;
  return tx && typeof tx === "object" ? tx : null;
}

function firstText(...values: unknown[]) {
  for (const v of values) {
    const txt = String(v || "").trim();
    if (txt) return txt;
  }
  return "";
}

function extractFailureMessage(payload: WompiPayload) {
  const tx = getTransactionFromPayload(payload);
  const statusMessage = firstText(
    (tx as any)?.status_message,
    (tx as any)?.statusMessage,
    (tx as any)?.status_reason,
    (tx as any)?.statusReason
  );
  if (statusMessage) return statusMessage;
  const method = (tx as any)?.payment_method;
  const extra = method && typeof method === "object" ? (method as any).extra : null;
  const extraMsg = firstText(extra?.status_message, extra?.statusMessage, extra?.message, extra?.error);
  return extraMsg;
}

function normalizeReference(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  return cleaned || undefined;
}

function isInternalReference(value: string | undefined): boolean {
  const ref = String(value || "").trim().toUpperCase();
  if (!ref) return false;
  return ref.startsWith("SUB_") || ref.startsWith("ORDER_") || ref.startsWith("WOMPI_") || ref.startsWith("TEST_");
}

function isOrderContactReference(value: string | undefined): boolean {
  const ref = String(value || "").trim().toUpperCase();
  return /^ORDER_CONTACT_[A-Z0-9]+_/i.test(ref);
}

function extractPaymentLinkId(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) {
      const parts = trimmed.split("/").filter(Boolean);
      return parts[parts.length - 1] || undefined;
    }
    return trimmed;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const direct = normalizeReference(obj.id);
    if (direct) return direct;
    const permalink = extractPaymentLinkId(obj.permalink);
    if (permalink) return permalink;
    const checkout = extractPaymentLinkId(obj.checkout_url ?? obj.checkoutUrl);
    if (checkout) return checkout;
  }
  return undefined;
}

function getPaymentLinkIdFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  return (
    normalizeReference(tx?.payment_link_id) ??
    normalizeReference(tx?.paymentLinkId) ??
    extractPaymentLinkId(tx?.payment_link) ??
    extractPaymentLinkId(tx?.paymentLink) ??
    extractPaymentLinkId((payload?.data as any)?.payment_link) ??
    extractPaymentLinkId((payload?.data as any)?.paymentLink)
  );
}

async function warnOnceWithDedupe(args: {
  source: string;
  message: string;
  dedupeKey: string;
  context?: Record<string, unknown>;
  windowMinutes?: number;
}) {
  const windowMinutes = Math.max(1, Number(args.windowMinutes || 360));
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const existing = await prisma.systemLog.findFirst({
    where: {
      level: LogLevel.WARN,
      source: args.source,
      message: args.message,
      createdAt: { gte: since },
      context: { path: ["dedupeKey"], equals: args.dedupeKey } as any
    },
    select: { id: true }
  });
  if (existing) return false;
  await systemLog(LogLevel.WARN, args.source, args.message, {
    ...(args.context || {}),
    dedupeKey: args.dedupeKey
  }, "webhook:wompi");
  return true;
}

function getCustomerEmailFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const email =
    tx?.customer_email ||
    tx?.customerEmail ||
    payload?.data?.customer_email ||
    payload?.data?.customerEmail ||
    tx?.customer_data?.email;
  const trimmed = String(email || "").trim().toLowerCase();
  return trimmed || undefined;
}

function getCustomerNameFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const name = tx?.customer_data?.full_name || tx?.customer_data?.name || tx?.customer_data?.fullName || tx?.customer?.name;
  const trimmed = String(name || "").trim();
  return trimmed || undefined;
}

function getCustomerPhoneFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const phone = tx?.customer_data?.phone_number || tx?.customer_data?.phoneNumber || tx?.customer?.phone_number || tx?.customer?.phone;
  const trimmed = String(phone || "").trim();
  return trimmed || undefined;
}

function normalizePhoneDigits(value: unknown): string {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("57") && digits.length > 10) return digits.slice(-10);
  return digits;
}

function phonesMatch(a: unknown, b: unknown): boolean {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  return da.length >= 8 && db.length >= 8 && (da.endsWith(db) || db.endsWith(da));
}

function normalizeNameForMatch(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function readSubscriptionPricingTotalInCents(subscriptionMeta: unknown, fallback: number): number {
  return getSubscriptionPricingTotal(subscriptionMeta, fallback);
}

type AssociationDecision = {
  subscriptionId: string;
  customerId?: string;
  score: number;
  reason: PaymentAssociationReason;
  criteria: Record<string, unknown>;
  cycleNumber?: number | null;
};

async function resolveAssociationByScore(args: {
  db: typeof prisma;
  tenantId?: string | null;
  amountInCents?: number | null;
  currency?: string | null;
  matchReason?: PaymentAssociationReason | null;
  paymentMatched?: { subscriptionId?: string | null; customerId?: string | null; cycleNumber?: number | null } | null;
  paymentLinkRecord?: { subscriptionId?: string | null } | null;
  referenceClassification: ReturnType<typeof classifyReference>;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): Promise<AssociationDecision | null> {
  const directSubscriptionId =
    args.paymentMatched?.subscriptionId ||
    args.paymentLinkRecord?.subscriptionId ||
    (args.referenceClassification.kind === "subscription" ? args.referenceClassification.subscriptionId : "");
  if (directSubscriptionId) {
    if (args.referenceClassification.kind === "subscription" && args.referenceClassification.subscriptionId) {
      const exists = await args.db.subscription.findUnique({
        where: { id: args.referenceClassification.subscriptionId },
        select: { id: true, customerId: true }
      });
      if (!exists) return null;
      return {
        subscriptionId: exists.id,
        customerId: exists.customerId ?? undefined,
        score: 100,
        reason: (args.matchReason || "SUB_REF") as any,
        criteria: {
          method: args.matchReason || "SUB_REF",
          referenceKind: args.referenceClassification.kind
        },
        cycleNumber: args.referenceClassification.cycle ?? args.paymentMatched?.cycleNumber ?? null
      };
    }
    return {
      subscriptionId: directSubscriptionId,
      customerId: args.paymentMatched?.customerId ?? undefined,
      score: 100,
      reason: (args.matchReason || "UNKNOWN") as any,
      criteria: {
        method: args.matchReason || "UNKNOWN"
      },
      cycleNumber: args.paymentMatched?.cycleNumber ?? null
    };
  }

  const incomingAmount = Number(args.amountInCents || 0);
  if (!incomingAmount) return null;
  const incomingCurrency = String(args.currency || "").trim().toUpperCase();

  const tenantScope = args.tenantId ? { tenantId: args.tenantId } : {};
  const customerIds = new Set<string>();
  let identitySource: "email" | "phone" | "name" | "email_phone" | null = null;

  if (args.email) {
    const byEmail = await args.db.customer.findMany({
      where: { email: args.email, ...tenantScope },
      select: { id: true }
    });
    if (byEmail.length) identitySource = "email";
    byEmail.forEach((c) => customerIds.add(c.id));
  }

  if (args.phone) {
    const byPhone = await args.db.customer.findMany({
      where: { phone: { not: null }, ...tenantScope },
      select: { id: true, phone: true },
      orderBy: { updatedAt: "desc" },
      take: 500
    });
    const matched = byPhone.filter((c) => phonesMatch(c.phone, args.phone));
    if (matched.length) identitySource = identitySource ? "email_phone" : "phone";
    matched.forEach((c) => customerIds.add(c.id));
  }

  if (!customerIds.size) {
    const nameNorm = normalizeNameForMatch(args.name);
    if (nameNorm.length >= 4) {
      const byName = await args.db.customer.findMany({
        where: { name: { contains: String(args.name || "").trim(), mode: "insensitive" }, ...tenantScope },
        select: { id: true, name: true },
        orderBy: { updatedAt: "desc" },
        take: 100
      });
      const matched = byName.filter((c) => normalizeNameForMatch(c.name) === nameNorm);
      if (matched.length) identitySource = "name";
      matched.forEach((c) => customerIds.add(c.id));
    }
  }

  if (!customerIds.size || !identitySource) return null;

  const candidates = await args.db.subscription.findMany({
    where: {
      customerId: { in: Array.from(customerIds) },
      ...(args.tenantId ? { tenantId: args.tenantId } : {})
    },
    include: {
      plan: {
        select: { priceInCents: true, currency: true, metadata: true, intervalUnit: true, intervalCount: true }
      }
    },
    orderBy: [{ updatedAt: "desc" }]
  });

  const withExactAmount = candidates.filter((s: any) => {
    const planAmount = readSubscriptionPricingTotalInCents(s?.metadata, s?.plan?.priceInCents || 0);
    const planCurrency = String(s?.plan?.currency || "").trim().toUpperCase();
    if (!incomingAmount) return false;
    if (incomingCurrency && planCurrency && incomingCurrency !== planCurrency) return false;
    return planAmount === incomingAmount;
  });

  if (!withExactAmount.length) return null;

  const score = identitySource === "name" ? 70 : 80;

  if (withExactAmount.length === 1) {
    const winner = withExactAmount[0];
    return {
      subscriptionId: winner.id,
      customerId: winner.customerId ?? undefined,
      score,
      reason: "IDENTITY_MATCH" as any,
      criteria: {
        method: "identity",
        source: identitySource,
        amountInCents: incomingAmount,
        currency: incomingCurrency || null
      }
    };
  }

  if (args.db === prisma) {
    await ensureBillingCyclesForSubscriptions(
      withExactAmount.map((sub: any) => ({
        id: sub.id,
        currentCycle: sub.currentCycle,
        currentPeriodStartAt: sub.currentPeriodStartAt,
        currentPeriodEndAt: sub.currentPeriodEndAt,
        cycleStartDay: sub.cycleStartDay,
        paymentDay: sub.paymentDay,
        paymentTiming: (sub.paymentTiming as any) || "EN_CURSO",
        graceDays: sub.graceDays,
        plan: {
          intervalUnit: sub.plan?.intervalUnit as any,
          intervalCount: sub.plan?.intervalCount
        }
      }))
    ).catch((err) => {
      logger.warn({ err, subscriptionIds: withExactAmount.map((sub: any) => sub.id) }, "processWompiEvent: fallo asegurando ciclos para desempate por identidad");
    });
  }

  const oldestCycles = await args.db.subscriptionBillingCycle.findMany({
    where: {
      subscriptionId: { in: withExactAmount.map((sub: any) => sub.id) },
      paymentId: null,
      status: { not: BillingCycleStatus.PAID }
    },
    orderBy: [{ dueAt: "asc" }, { periodStartAt: "asc" }, { cycleNumber: "asc" }],
    take: 1
  });
  const oldest = oldestCycles[0];
  if (!oldest) return null;

  const winner = withExactAmount.find((sub: any) => sub.id === oldest.subscriptionId);
  if (!winner) return null;

  return {
    subscriptionId: winner.id,
    customerId: winner.customerId ?? undefined,
    score,
    reason: "IDENTITY_MATCH" as any,
    criteria: {
      method: "identity",
      source: identitySource,
      amountInCents: incomingAmount,
      currency: incomingCurrency || null,
      tieBreak: "oldest_unpaid_cycle"
    },
    cycleNumber: oldest.cycleNumber
  };
}

async function findOldestUnpaidCycle(args: {
  db: typeof prisma;
  subscription: Subscription & { plan: { intervalUnit: string; intervalCount: number } };
}) {
  if (args.db === prisma) {
    await ensureBillingCyclesForSubscriptions([
      {
        id: args.subscription.id,
        currentCycle: args.subscription.currentCycle,
        currentPeriodStartAt: args.subscription.currentPeriodStartAt,
        currentPeriodEndAt: args.subscription.currentPeriodEndAt,
        cycleStartDay: args.subscription.cycleStartDay,
        paymentDay: args.subscription.paymentDay,
        paymentTiming: (args.subscription.paymentTiming as any) || "EN_CURSO",
        graceDays: args.subscription.graceDays,
        plan: {
          intervalUnit: args.subscription.plan.intervalUnit as any,
          intervalCount: args.subscription.plan.intervalCount
        }
      }
    ]).catch((err) => {
      logger.warn({ err, subscriptionId: args.subscription.id }, "processWompiEvent: fallo asegurando ciclos para oldest unpaid");
    });
  }

  const cycles = await args.db.subscriptionBillingCycle.findMany({
    where: {
      subscriptionId: args.subscription.id,
      paymentId: null,
      status: { not: BillingCycleStatus.PAID }
    },
    orderBy: [{ cycleNumber: "asc" }]
  });
  return cycles[0] ?? null;
}

function getPaidAtFromPayload(payload: WompiPayload): Date | null {
  const tx = getTransactionFromPayload(payload);
  const raw =
    tx?.paid_at ||
    tx?.paidAt ||
    tx?.finalized_at ||
    tx?.finalizedAt ||
    tx?.created_at ||
    tx?.createdAt ||
    payload?.timestamp;
  if (!raw) return null;
  const rawNum = Number(raw);
  const normalizedRaw =
    Number.isFinite(rawNum) && rawNum > 0
      ? (rawNum < 1_000_000_000_000 ? rawNum * 1000 : rawNum)
      : raw;
  const dt = new Date(normalizedRaw as any);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getProviderEventAt(providerTs: bigint | null | undefined): Date | null {
  if (providerTs == null) return null;
  const num = Number(providerTs);
  if (!Number.isFinite(num) || num <= 0) return null;
  const ms = num < 1_000_000_000_000 ? num * 1000 : num;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getPaymentSourceFromProviderResponse(resp: unknown) {
  if (!resp || typeof resp !== "object") return "";
  const order = (resp as Record<string, unknown>).order;
  if (!order || typeof order !== "object") return "";
  return String((order as Record<string, unknown>).source || "").toUpperCase();
}

function resolvePersistedPaymentStatus(
  prev: PaymentStatus | null,
  incoming: PaymentStatus | null
): PaymentStatus | null {
  if (!incoming) return prev;
  if (!prev) return incoming;
  if (prev === PaymentStatus.APPROVED) return PaymentStatus.APPROVED;
  if (incoming === PaymentStatus.APPROVED) return PaymentStatus.APPROVED;
  if (
    (prev === PaymentStatus.DECLINED || prev === PaymentStatus.ERROR || prev === PaymentStatus.VOIDED) &&
    incoming === PaymentStatus.PENDING
  ) {
    return prev;
  }
  return incoming;
}

export async function processWompiEventLogic(webhookEventId: string, db: typeof prisma) {
  // Lock to prevent race conditions between inline processing and background worker.
  const lockKey = `webhook-process:${webhookEventId}`;
  const lockAcquired = await db.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) as locked
  `.then(rows => Boolean(rows?.[0]?.locked)).catch((err) => {
    logger.warn({ err, webhookEventId }, "processWompiEvent: fallo adquiriendo advisory lock");
    return false;
  });

  if (!lockAcquired) {
    logger.info({ webhookEventId }, "Webhook processing already in progress (lock skip)");
    return;
  }

  try {
    const event = await db.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) return;
    if (event.processStatus === WebhookProcessStatus.PROCESSED) return;

  const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as WompiPayload;
  const paymentsCfg = await getPaymentsConfig().catch(() => ({
    autoReconcileUnlinkedPayments: true,
    acceptUnlinkedPayments: true,
    notifyWhatsappForUnlinkedPayments: true,
    includeUnlinkedPaymentsInMetrics: true
  }));
  const tx = getTransactionFromPayload(payload);
  const reference: string | undefined = normalizeReference(tx?.reference);
  const transactionId: string | undefined = normalizeReference(tx?.id);
  const paymentLinkId: string | undefined = getPaymentLinkIdFromPayload(payload);
  const status: string | undefined = tx?.status;
  const amountInCents: number | undefined = tx?.amount_in_cents ?? tx?.amountInCents;
  const currency: string | undefined = tx?.currency;
  const checkoutUrlFromLink = paymentLinkId
    ? (() => {
        const rawBase = getWompiCheckoutLinkBaseUrl();
        return rawBase.then((base) => {
          const normalized = base.endsWith("/") ? base : `${base}/`;
          return `${normalized}${paymentLinkId}`;
        });
      })()
    : Promise.resolve<string | undefined>(undefined);

  // Prefer mapping by payment_link_id (subscriptions created via API payment links)
  let paymentByLink = paymentLinkId
    ? await db.payment.findUnique({ where: { wompiPaymentLinkId: paymentLinkId } })
    : null;
  const paymentLinkRecord = paymentLinkId
    ? await db.paymentLink.findUnique({
        where: { wompiPaymentLinkId: paymentLinkId },
        select: { paymentId: true, subscriptionId: true }
      })
    : null;
  if (!paymentByLink && paymentLinkRecord?.paymentId) {
    paymentByLink = await db.payment.findUnique({ where: { id: paymentLinkRecord.paymentId } });
  }
  const paymentByTxId = transactionId
    ? await db.payment.findUnique({ where: { wompiTransactionId: transactionId } })
    : null;
  let paymentByReference = reference
    ? await db.payment.findFirst({
        where: {
          reference,
          ...(event.tenantId ? { tenantId: event.tenantId } : {})
        },
        orderBy: { createdAt: "desc" }
      })
    : null;
  if (!paymentByReference && reference && event.tenantId) {
    paymentByReference = await db.payment.findFirst({
      where: { reference },
      orderBy: { createdAt: "desc" }
    });
  }
  const paymentMatched = paymentByLink ?? paymentByTxId ?? paymentByReference ?? null;
  const referenceClassification = classifyReference(reference);

  const matchReason =
    paymentByLink || paymentLinkRecord?.paymentId
      ? "LINK_MATCH"
      : paymentByTxId
        ? "TX_MATCH"
        : paymentByReference
          ? "REF_MATCH"
          : referenceClassification.kind === "subscription" && referenceClassification.subscriptionId
            ? "SUB_REF"
            : null;

  const paymentSource = getPaymentSourceFromProviderResponse(paymentMatched?.providerResponse);
  const isShopifyPayment =
    referenceClassification.kind === "shopify" ||
    paymentSource === "SHOPIFY";

  // Shopify payments are forwarded but not processed as subscriptions.
  if (isShopifyPayment) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.SKIPPED, processedAt: new Date() }
    });
    return;
  }

  let inferredSubscriptionId =
    paymentMatched?.subscriptionId ??
    paymentLinkRecord?.subscriptionId ??
    (referenceClassification.kind === "subscription" ? referenceClassification.subscriptionId : "");

  let inferredSubscription: Subscription | null = null;

  const email = getCustomerEmailFromPayload(payload);
  const phone = getCustomerPhoneFromPayload(payload);
  const name = getCustomerNameFromPayload(payload);
  let associationScore: number | null = null;
  let associationCriteria: Record<string, unknown> | null = null;
  let associationReasonFromScore: PaymentAssociationReason | null = null;
  let associationCycleNumber: number | null = null;
  let associationCycleId: string | null = null;
  
  const missingPaymentLinkRecord = Boolean(paymentLinkId && !paymentByLink && !paymentLinkRecord);
  const likelyExternalRefOnly = !paymentMatched && !paymentLinkRecord && referenceClassification.kind === "unknown" && !isInternalReference(reference);
  if (missingPaymentLinkRecord && !likelyExternalRefOnly) {
    await warnOnceWithDedupe({
      source: "processWompiEvent",
      message: "payment_link_not_found: proceeding by inference",
      dedupeKey: `${String(paymentLinkId || "sin_link")}|${String(reference || "sin_ref")}`,
      context: { paymentLinkId, reference },
      windowMinutes: 360
    }).catch((err) => {
      logger.warn({ err, paymentLinkId, reference }, "processWompiEvent: fallo registrando advertencia deduplicada");
    });
  }

  // FIX: Si la referencia viene de un cobro manual (SUB_xxx_cycle), usar ese subscriptionId directamente
  // La inferencia por identidad solo debe usarse cuando NO hay referencia estructurada
  if (referenceClassification.kind === "subscription" && referenceClassification.subscriptionId && !paymentMatched) {
    const exists = await db.subscription.findUnique({
      where: { id: referenceClassification.subscriptionId },
      select: { id: true }
    });
    if (exists) {
      inferredSubscriptionId = referenceClassification.subscriptionId;
    }
  }

  // FIX: Si la referencia es SUB_xxx_cycle y no hay payment matched, usar el subscriptionId de la referencia
  // La inferencia por identidad SOLO debe usarse para referencias desconocidas
  const hasStructuredReference = referenceClassification.kind === "subscription" && referenceClassification.subscriptionId;

  const canTryIdentity = paymentsCfg.autoReconcileUnlinkedPayments && !inferredSubscriptionId && !hasStructuredReference;
  const shouldResolveScore = Boolean(matchReason || hasStructuredReference || canTryIdentity);
  if (shouldResolveScore) {
    const decision = await resolveAssociationByScore({
      db,
      tenantId: event.tenantId,
      amountInCents,
      currency,
      matchReason: matchReason as any,
      paymentMatched,
      paymentLinkRecord,
      referenceClassification,
      email,
      phone,
      name
    });
    if (decision?.subscriptionId) {
      inferredSubscriptionId = decision.subscriptionId;
      associationScore = decision.score;
      associationCriteria = decision.criteria;
      associationReasonFromScore = decision.reason;
      associationCycleNumber = decision.cycleNumber ?? null;
      if (decision.reason === "IDENTITY_MATCH") {
        await systemLog(LogLevel.INFO, "processWompiEvent", "subscription_inferred_by_scoring", {
          reference,
          subscriptionId: decision.subscriptionId,
          score: decision.score,
          criteria: decision.criteria
        }, "webhook:wompi").catch((err: any) => {
          logger.warn({ err, reference, subscriptionId: decision.subscriptionId }, "processWompiEvent: fallo escribiendo systemLog de inferencia por scoring");
        });
      }
    } else if (hasStructuredReference) {
      await systemLog(LogLevel.INFO, "processWompiEvent", "Payment no encontrado, se usará referencia estructurada", {
        reference,
        subscriptionIdFromRef: referenceClassification.subscriptionId,
        kind: referenceClassification.kind
      }, "webhook:wompi").catch((err: any) => {
        logger.warn({ err, reference }, "processWompiEvent: fallo escribiendo systemLog de referencia estructurada");
      });
    }
  }

  const subscriptionId = inferredSubscriptionId;

  const isSubscription = !!subscriptionId;
  // Registrar pago y, si está aprobado, renovar ciclo (solo para suscripciones).
  const subscription =
    inferredSubscription ??
    (isSubscription
      ? await db.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } })
      : null);
  if (isSubscription && !subscription) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "subscription not found", processedAt: new Date() }
    });
    return;
  }

  if (subscription && associationReasonFromScore === "IDENTITY_MATCH" && !associationCycleNumber) {
    const oldest = await findOldestUnpaidCycle({ db, subscription });
    if (oldest) {
      associationCycleId = oldest.id;
      associationCycleNumber = oldest.cycleNumber;
    }
  }
  if (subscription && associationCycleNumber != null && !associationCycleId) {
    if (db === prisma) {
      await ensureBillingCyclesForSubscriptions([
        {
          id: subscription.id,
          currentCycle: subscription.currentCycle,
          currentPeriodStartAt: subscription.currentPeriodStartAt,
          currentPeriodEndAt: subscription.currentPeriodEndAt,
          cycleStartDay: subscription.cycleStartDay,
          paymentDay: subscription.paymentDay,
          paymentTiming: (subscription.paymentTiming as any) || "EN_CURSO",
          graceDays: subscription.graceDays,
          plan: {
            intervalUnit: subscription.plan.intervalUnit as any,
            intervalCount: subscription.plan.intervalCount
          }
        }
      ]).catch((err) => {
        logger.warn({ err, subscriptionId: subscription.id, cycleNumber: associationCycleNumber }, "processWompiEvent: fallo asegurando ciclos para cycleNumber");
      });
    }
    const cycleByNumber = await db.subscriptionBillingCycle.findUnique({
      where: { subscriptionId_cycleNumber: { subscriptionId: subscription.id, cycleNumber: associationCycleNumber } }
    });
    if (cycleByNumber) associationCycleId = cycleByNumber.id;
  }

  const normalizedStatus = String(status || "").toUpperCase();
  const paymentStatus =
    normalizedStatus === "APPROVED"
      ? PaymentStatus.APPROVED
      : normalizedStatus === "DECLINED"
        ? PaymentStatus.DECLINED
        : normalizedStatus === "ERROR"
          ? PaymentStatus.ERROR
          : normalizedStatus === "VOIDED"
            ? PaymentStatus.VOIDED
            : normalizedStatus === "PENDING" || normalizedStatus === "PROCESSING"
              ? PaymentStatus.PENDING
              : null;

  const prevByTx = transactionId != null ? await db.payment.findUnique({ where: { wompiTransactionId: transactionId } }) : null;
  const prevStatus = prevByTx?.status ?? paymentMatched?.status ?? null;
  const nextStatus = resolvePersistedPaymentStatus(prevStatus, paymentStatus);

  const cycleFromRef = referenceClassification.kind === "subscription" ? referenceClassification.cycle ?? null : null;
  const cycle = paymentMatched?.cycleNumber ?? cycleFromRef ?? associationCycleNumber ?? (subscription?.currentCycle ?? 1);
  const subscriptionCycleKey = subscription ? `${subscription.id}:${cycle}` : null;
  const wasApproved = prevStatus === PaymentStatus.APPROVED;
  const wasFailed = prevStatus === PaymentStatus.DECLINED || prevStatus === PaymentStatus.ERROR || prevStatus === PaymentStatus.VOIDED;

  const now = new Date();
  const paidAtFromPayload = getPaidAtFromPayload(payload);
  const providerEventAt = getProviderEventAt(event.providerTs);
  const paidAt =
    nextStatus === PaymentStatus.APPROVED
      ? (paidAtFromPayload ?? providerEventAt ?? event.receivedAt ?? now)
      : null;
  const computedFailedAt = nextStatus && nextStatus !== PaymentStatus.APPROVED && nextStatus !== PaymentStatus.PENDING ? now : null;

  const shouldIgnoreUnlinked = !subscription && !paymentsCfg.acceptUnlinkedPayments;
  const reconciliationForUnlinked = shouldIgnoreUnlinked
    ? { status: "IGNORED_EXTERNAL", reason: "unlinked_payment", at: new Date().toISOString() }
    : null;

  const associationReason =
    (paymentMatched?.associationReason as any) ||
    (associationReasonFromScore as any) ||
    (matchReason as any) ||
    (shouldIgnoreUnlinked ? "UNLINKED" : null) ||
    "UNKNOWN";

  const origin =
    (paymentMatched as any)?.origin ||
    (paymentByLink as any)?.origin ||
    (paymentByTxId as any)?.origin ||
    (paymentByReference as any)?.origin ||
    "WEBHOOK";

  const matchMetaData =
    associationScore != null
      ? ({
          matchScore: associationScore,
          matchCriteria: associationCriteria as Prisma.InputJsonValue
        } as const)
      : {};

  let paymentResolved = paymentMatched;
  if (!paymentResolved && !subscription) {
    const tenantIdFallback = event.tenantId ?? (await getDefaultTenantId());
    if (!tenantIdFallback) {
      await db.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "missing_tenant", processedAt: new Date() }
      });
      return;
    }

    const email = getCustomerEmailFromPayload(payload);
    const phone = getCustomerPhoneFromPayload(payload);
    let customer = null as any;
    let emailConflictOtherTenant = false;
    const byEmail = email ? await db.customer.findUnique({ where: { email } }) : null;
    if (byEmail) {
      if (!tenantIdFallback || byEmail.tenantId === tenantIdFallback) {
        customer = byEmail;
      } else {
        const linked = await db.customerTenant.findFirst({
          where: { customerId: byEmail.id, tenantId: tenantIdFallback },
          select: { id: true }
        });
        if (linked) customer = byEmail;
        else emailConflictOtherTenant = true;
      }
    }
    if (!customer && phone) {
      const byPhone = await db.customer.findMany({
        where: {
          phone: { not: null },
          ...(tenantIdFallback
            ? {
                OR: [{ tenantId: tenantIdFallback }, { tenantLinks: { some: { tenantId: tenantIdFallback } } }]
              }
            : {})
        },
        select: { id: true, phone: true },
        take: 300
      });
      const matchedPhone = byPhone.find((c: any) => phonesMatch(c.phone, phone));
      if (matchedPhone?.id) {
        customer = await db.customer.findUnique({ where: { id: matchedPhone.id } });
      }
    }
    if (!customer) {
      const name = String(getCustomerNameFromPayload(payload) || "").trim();
      const emailValue = String(email || "").trim();
      const phoneValue = String(phone || "").trim();
      if (!name || !emailValue || !phoneValue) {
        await db.webhookEvent.update({
          where: { id: webhookEventId },
          data: {
            processStatus: WebhookProcessStatus.FAILED,
            errorMessage: "missing_customer_fields",
            processedAt: new Date()
          }
        });
        await systemLog(LogLevel.WARN, "wompi.webhook", "No se crea contacto: faltan nombre/email/teléfono", {
          webhookEventId,
          tenantId: tenantIdFallback,
          hasName: Boolean(name),
          hasEmail: Boolean(emailValue),
          hasPhone: Boolean(phoneValue)
        }, "webhook:wompi").catch((err) => {
          logger.warn({ err, webhookEventId }, "wompi.webhook: failed to write system log");
        });
        return;
      }

      const fallbackMeta: Record<string, unknown> = { source: "wompi_webhook_fallback" };
      if (email) fallbackMeta.incomingEmail = email;
      if (emailConflictOtherTenant) fallbackMeta.emailTenantConflict = true;
      customer = await db.customer.create({
        data: {
          tenantId: tenantIdFallback,
          email: emailConflictOtherTenant ? null : emailValue,
          name,
          phone: phoneValue,
          metadata: fallbackMeta as Prisma.InputJsonValue
        }
      });
    }

    const fallbackReference = reference ?? (transactionId ? `WOMPI_${transactionId}` : `WOMPI_WEBHOOK_${webhookEventId}`);
    const fallbackCurrency = String(currency || "COP").trim().toUpperCase() || "COP";
    const fallbackStatus = nextStatus ?? PaymentStatus.PENDING;

    // FIX: Si hay referencia estructurada SUB_xxx, intentar asignar la suscripción
    let fallbackSubscriptionId: string | null = null;
    let fallbackCustomerId: string = customer.id;
    if (referenceClassification.kind === "subscription" && referenceClassification.subscriptionId) {
      const subFromRef = await db.subscription.findUnique({
        where: { id: referenceClassification.subscriptionId },
        select: { id: true, customerId: true }
      }).catch((err) => {
        logger.warn({ err, subscriptionId: referenceClassification.subscriptionId }, "processWompiEvent: fallo resolviendo suscripción desde referencia");
        return null;
      });
      if (subFromRef) {
        fallbackSubscriptionId = subFromRef.id;
        fallbackCustomerId = subFromRef.customerId;
      }
    }

    if (transactionId) {
      paymentResolved = await db.payment.upsert({
        where: { wompiTransactionId: transactionId },
        create: {
          tenantId: tenantIdFallback,
          customerId: fallbackCustomerId,
          amountInCents: amountInCents ?? 0,
          currency: fallbackCurrency,
          reference: fallbackReference,
          wompiTransactionId: transactionId,
          wompiPaymentLinkId: paymentLinkId,
          status: fallbackStatus,
          paidAt: fallbackStatus === PaymentStatus.APPROVED ? paidAt : null,
          failedAt:
            fallbackStatus === PaymentStatus.APPROVED || fallbackStatus === PaymentStatus.PENDING
              ? null
              : computedFailedAt,
          subscriptionId: fallbackSubscriptionId,
          origin,
          associationReason: associationReason as any,
          associatedBy: "system",
          ...matchMetaData,
          providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) } as Prisma.InputJsonValue
        },
        update: {
          tenantId: tenantIdFallback,
          customerId: fallbackCustomerId,
          amountInCents: amountInCents ?? undefined,
          currency: fallbackCurrency,
          reference: fallbackReference,
          wompiPaymentLinkId: paymentLinkId ?? undefined,
          status: fallbackStatus,
          paidAt: fallbackStatus === PaymentStatus.APPROVED ? paidAt : undefined,
          failedAt:
            fallbackStatus === PaymentStatus.APPROVED
              ? null
              : fallbackStatus === PaymentStatus.PENDING
                ? undefined
                : computedFailedAt,
          subscriptionId: fallbackSubscriptionId ?? undefined,
          origin: (paymentResolved as any)?.origin ?? origin,
          associationReason: (paymentResolved as any)?.associationReason ?? (associationReason as any),
          associatedBy: (paymentResolved as any)?.associatedBy ?? "system",
          ...matchMetaData,
          providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) } as Prisma.InputJsonValue
        }
      });
    } else if (paymentLinkId) {
      paymentResolved = await db.payment.upsert({
        where: { wompiPaymentLinkId: paymentLinkId },
        create: {
          tenantId: tenantIdFallback,
          customerId: fallbackCustomerId,
          amountInCents: amountInCents ?? 0,
          currency: fallbackCurrency,
          reference: fallbackReference,
          wompiPaymentLinkId: paymentLinkId,
          status: fallbackStatus,
          paidAt: fallbackStatus === PaymentStatus.APPROVED ? paidAt : null,
          failedAt:
            fallbackStatus === PaymentStatus.APPROVED || fallbackStatus === PaymentStatus.PENDING
              ? null
              : computedFailedAt,
          subscriptionId: fallbackSubscriptionId,
          origin,
          associationReason: associationReason as any,
          associatedBy: "system",
          ...matchMetaData,
          providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) } as Prisma.InputJsonValue
        },
        update: {
          tenantId: tenantIdFallback,
          customerId: fallbackCustomerId,
          amountInCents: amountInCents ?? undefined,
          currency: fallbackCurrency,
          reference: fallbackReference,
          status: fallbackStatus,
          paidAt: fallbackStatus === PaymentStatus.APPROVED ? paidAt : undefined,
          failedAt:
            fallbackStatus === PaymentStatus.APPROVED
              ? null
              : fallbackStatus === PaymentStatus.PENDING
                ? undefined
                : computedFailedAt,
          subscriptionId: fallbackSubscriptionId ?? undefined,
          origin: (paymentResolved as any)?.origin ?? origin,
          associationReason: (paymentResolved as any)?.associationReason ?? (associationReason as any),
          associatedBy: (paymentResolved as any)?.associatedBy ?? "system",
          ...matchMetaData,
          providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) } as Prisma.InputJsonValue
        }
      });
    } else {
      paymentResolved = await db.payment.create({
        data: {
          tenantId: tenantIdFallback,
          customerId: fallbackCustomerId,
          amountInCents: amountInCents ?? 0,
          currency: fallbackCurrency,
          reference: fallbackReference,
          status: fallbackStatus,
          paidAt: fallbackStatus === PaymentStatus.APPROVED ? paidAt : null,
          failedAt:
            fallbackStatus === PaymentStatus.APPROVED || fallbackStatus === PaymentStatus.PENDING
              ? null
              : computedFailedAt,
          subscriptionId: fallbackSubscriptionId,
          origin,
          associationReason: associationReason as any,
          associatedBy: "system",
          ...matchMetaData,
          providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) } as Prisma.InputJsonValue
        }
      });
    }

    await systemLog(LogLevel.WARN, "webhooks.wompi", "Webhook sin suscripción asociada; pago creado en fallback", {
      webhookEventId,
      paymentId: paymentResolved.id,
      transactionId,
      paymentLinkId,
      reference: fallbackReference,
      customerId: customer.id
    }, "webhook:wompi").catch((err) => {
      logger.warn({ err, webhookEventId, paymentId: paymentResolved.id }, "processWompiEvent: fallo escribiendo systemLog de fallback sin suscripción");
    });
  }

  const tenantIdForPayment =
    subscription?.tenantId ?? paymentResolved?.tenantId ?? (await getDefaultTenantId());
  if (!tenantIdForPayment) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "missing_tenant", processedAt: new Date() }
    });
    return;
  }

  const checkoutUrlResolved = await checkoutUrlFromLink;
  const resolvedCheckoutUrl =
    paymentResolved?.checkoutUrl ||
    prevByTx?.checkoutUrl ||
    checkoutUrlResolved;
  const wompiTransactionUpdate = transactionId ? { wompiTransactionId: transactionId } : {};
  const inferredSubscriptionCycleKey =
    subscription && Number.isFinite(Number(cycle)) ? `${subscription.id}:${cycle}` : null;
  let canAssignSubscriptionCycleKey = false;
  if (paymentResolved?.id && inferredSubscriptionCycleKey) {
    const sameCycle = await db.payment.findUnique({
      where: { subscriptionCycleKey: inferredSubscriptionCycleKey },
      select: { id: true }
    });
    canAssignSubscriptionCycleKey = !sameCycle || sameCycle.id === paymentResolved.id;
  }

	  const paymentRecord = paymentResolved
	    ? await db.payment.update({
	        where: { id: paymentResolved.id },
        data: {
          ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
          ...wompiTransactionUpdate,
          ...(nextStatus ? { status: nextStatus } : {}),
          paidAt: nextStatus === PaymentStatus.APPROVED ? paidAt : paymentResolved.paidAt ?? null,
          failedAt:
            nextStatus === PaymentStatus.APPROVED
              ? null
              : nextStatus === PaymentStatus.PENDING
                ? paymentResolved.failedAt ?? null
                : paymentResolved.failedAt ?? computedFailedAt,
          origin: (paymentResolved as any)?.origin ?? origin,
          associationReason: (paymentResolved as any)?.associationReason ?? (associationReason as any),
          associatedBy: (paymentResolved as any)?.associatedBy ?? "system",
          ...matchMetaData,
          providerResponse:
            paymentResolved.providerResponse && typeof paymentResolved.providerResponse === "object"
              ? ({
                  ...(paymentResolved.providerResponse as Record<string, unknown>),
                  webhook: payload,
	                  ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {})
	                } as Prisma.InputJsonValue)
	              : ({ webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) } as Prisma.InputJsonValue),
	          amountInCents: amountInCents ?? paymentResolved.amountInCents,
	          currency: currency ?? paymentResolved.currency,
	          reference: reference ?? paymentResolved.reference,
          ...(subscription
            ? {
                subscriptionId: subscription.id,
                customerId: subscription.customerId,
                cycleNumber: paymentResolved.cycleNumber ?? cycle
              }
            : {}),
          ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
          subscriptionCycleKey:
            subscription && inferredSubscriptionCycleKey && canAssignSubscriptionCycleKey
              ? inferredSubscriptionCycleKey
              : paymentResolved.subscriptionCycleKey
        }
      })
    : await db.payment.upsert({
        where: { subscriptionCycleKey: subscriptionCycleKey as string },
        create: {
          tenant: { connect: { id: tenantIdForPayment! } },
          customer: { connect: { id: subscription!.customerId } },
          subscription: { connect: { id: subscription!.id } },
          amountInCents: amountInCents ?? 0,
          currency: currency ?? "COP",
          cycleNumber: cycle,
          reference: reference ?? `SUB_${subscription!.id}_${cycle}`,
          ...wompiTransactionUpdate,
          wompiPaymentLinkId: paymentLinkId,
          ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
          paidAt,
          failedAt: computedFailedAt,
          origin,
          associationReason: associationReason as any,
          associatedBy: "system",
          ...matchMetaData,
          providerResponse: { webhook: payload } as Prisma.InputJsonValue,
          subscriptionCycleKey: subscriptionCycleKey as string
        },
        update: {
          ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
          ...wompiTransactionUpdate,
          ...(nextStatus ? { status: nextStatus } : {}),
          paidAt,
          failedAt:
            nextStatus === PaymentStatus.APPROVED
              ? null
              : nextStatus === PaymentStatus.PENDING
                ? prevByTx?.failedAt ?? null
                : prevByTx?.failedAt ?? computedFailedAt,
          origin: (prevByTx as any)?.origin ?? origin,
          associationReason: (prevByTx as any)?.associationReason ?? (associationReason as any),
          associatedBy: (prevByTx as any)?.associatedBy ?? "system",
          ...matchMetaData,
          providerResponse: { webhook: payload } as Prisma.InputJsonValue,
          reference: reference ?? undefined,
          ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
          wompiPaymentLinkId: paymentLinkId ?? undefined
        }
      });

  if (paymentRecord.subscriptionId && paymentRecord.paidAt) {
    if (associationCycleId) {
      await attachPaymentToCycle({
        subscriptionId: paymentRecord.subscriptionId,
        paymentId: paymentRecord.id,
        cycleId: associationCycleId,
        paymentAt: paymentRecord.paidAt,
        origin: paymentRecord.origin,
        associationReason: paymentRecord.associationReason as any,
        associatedBy: paymentRecord.associatedBy || "system"
      }).catch((err) => {
        logger.warn({ err, paymentId: paymentRecord.id, cycleId: associationCycleId }, "processWompiEvent: fallo adjuntando pago a ciclo específico");
      });
    } else {
      await attachPaymentToMatchingCycle({
        subscriptionId: paymentRecord.subscriptionId,
        paymentId: paymentRecord.id,
        paymentAt: paymentRecord.paidAt,
        origin: paymentRecord.origin,
        associationReason: paymentRecord.associationReason as any,
        associatedBy: paymentRecord.associatedBy || "system"
      }).catch((err) => {
        logger.warn({ err, paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId }, "processWompiEvent: fallo adjuntando pago al ciclo coincidente");
      });
    }
  }

  if (paymentRecord.subscriptionId && paymentRecord.wompiPaymentLinkId && paymentRecord.checkoutUrl) {
    const planId =
      subscription?.planId ??
      (await db.subscription.findUnique({ where: { id: paymentRecord.subscriptionId }, select: { planId: true } }))?.planId;
    if (planId) {
      await db.paymentLink
        .upsert({
          where: { paymentId: paymentRecord.id },
          create: {
            tenantId: tenantIdForPayment,
            planId,
            subscriptionId: paymentRecord.subscriptionId,
            paymentId: paymentRecord.id,
            wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
            checkoutUrl: paymentRecord.checkoutUrl,
            status: paymentRecord.status === PaymentStatus.APPROVED ? PaymentLinkStatus.PAID : PaymentLinkStatus.SENT,
            sentAt: new Date(),
            paidAt: paymentRecord.paidAt ?? null
          },
          update: {
            ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
            planId,
            subscriptionId: paymentRecord.subscriptionId,
            wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
            checkoutUrl: paymentRecord.checkoutUrl,
            status: paymentRecord.status === PaymentStatus.APPROVED ? PaymentLinkStatus.PAID : undefined,
            paidAt: paymentRecord.paidAt ?? null
          }
        })
        .catch((err) => {
          logger.warn({ err, paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId }, "processWompiEvent: fallo sincronizando paymentLink");
        });
    }
  }

  await systemLog(LogLevel.INFO, "webhooks.wompi", "Webhook conciliado", {
    webhookEventId,
    paymentId: paymentRecord.id,
    paymentStatus: paymentRecord.status,
    wompiTransactionId: paymentRecord.wompiTransactionId,
    wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
    reference: paymentRecord.reference,
    subscriptionId: paymentRecord.subscriptionId
  }, "webhook:wompi").catch((err: any) => {
    logger.warn({ err, webhookEventId, paymentId: paymentRecord.id }, "processWompiEvent: fallo escribiendo systemLog de webhook conciliado");
  });
  void publishRealtime("payments", {
    type: "payment_status",
    paymentId: paymentRecord.id,
    status: paymentRecord.status,
    wompiTransactionId: paymentRecord.wompiTransactionId,
    wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
    reference: paymentRecord.reference,
    subscriptionId: paymentRecord.subscriptionId,
    customerId: paymentRecord.customerId,
    amountInCents: paymentRecord.amountInCents,
    updatedAt: new Date().toISOString()
  });

  await db.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processStatus: WebhookProcessStatus.PROCESSED, processedAt: new Date() }
  });

  await schedulePaymentStatusNotifications({ paymentId: paymentRecord.id, forceNow: true }).catch((err) => {
    systemLog(LogLevel.ERROR, "notifications.payment_status", "Fallo al programar notificaciones de pago", {
      paymentId: paymentRecord.id,
      error: String(err?.message || err)
    }, "webhook:wompi").catch((logErr: any) => {
      logger.warn({ err: logErr, paymentId: paymentRecord.id }, "processWompiEvent: fallo escribiendo systemLog de notificaciones de pago");
    });
  });
  await syncChatwootAttributesForCustomer(paymentRecord.customerId).catch((err) => {
    systemLog(LogLevel.WARN, "chatwoot.sync", "Fallo al sincronizar atributos de Chatwoot", {
      customerId: paymentRecord.customerId,
      error: String(err?.message || err)
    }, "webhook:wompi").catch((logErr: any) => {
      logger.warn({ err: logErr, customerId: paymentRecord.customerId }, "processWompiEvent: fallo escribiendo systemLog de sync Chatwoot");
    });
  });

  const becameApproved = !wasApproved && nextStatus === PaymentStatus.APPROVED;
  const becameFailed = !wasFailed && (nextStatus === PaymentStatus.DECLINED || nextStatus === PaymentStatus.ERROR || nextStatus === PaymentStatus.VOIDED);
  if (becameApproved) {
    await consumeApp("payments_success", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
    void publishRealtime("payments", {
      type: "payment_approved",
      paymentId: paymentRecord.id,
      status: paymentRecord.status,
      subscriptionId: paymentRecord.subscriptionId,
      customerId: paymentRecord.customerId,
      amountInCents: paymentRecord.amountInCents,
      paidAt: paymentRecord.paidAt || null,
      updatedAt: new Date().toISOString()
    });
  } else if (becameFailed) {
    await consumeApp("payments_failed", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
    void publishRealtime("payments", {
      type: "payment_failed",
      paymentId: paymentRecord.id,
      status: paymentRecord.status,
      subscriptionId: paymentRecord.subscriptionId,
      customerId: paymentRecord.customerId,
      amountInCents: paymentRecord.amountInCents,
      updatedAt: new Date().toISOString()
    });
  }

  if (becameFailed) {
    const failureMessage = extractFailureMessage(payload);
    const lastAttempt = await db.paymentAttempt.findFirst({
      where: { paymentId: paymentRecord.id },
      orderBy: { attemptNo: "desc" },
      select: { attemptNo: true }
    });
    const nextAttemptNo = Number.isFinite(lastAttempt?.attemptNo) ? (lastAttempt!.attemptNo + 1) : 1;
    await db.paymentAttempt.create({
      data: {
        paymentId: paymentRecord.id,
        attemptNo: nextAttemptNo,
        status: "TRANSACTION_DECLINED",
        provider: "wompi",
        errorCode: nextStatus || "DECLINED",
        errorMessage: failureMessage || "Pago rechazado por el emisor.",
        response: payload as Prisma.InputJsonValue
      }
    }).catch((err) => {
      logger.warn({ err, paymentId: paymentRecord.id }, "processWompiEvent: fallo creando paymentAttempt fallido");
    });
  }

  if (becameApproved) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: paymentRecord.customerId,
      tenantId: tenantIdForPayment,
      kind: GAMIFICATION_EVENT_KINDS.PAYMENT_APPROVED,
      moneyInCents: paymentRecord.amountInCents,
      metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
    }).catch((err) => {
      logger.warn({ err, paymentId: paymentRecord.id, customerId: paymentRecord.customerId }, "processWompiEvent: fallo aplicando gamificación a customer por pago aprobado");
    });

    if (subscription?.planId) {
      const moneyPts = moneyToPoints(paymentRecord.amountInCents, GAMIFICATION_WEIGHTS.paymentApproved.moneyScale);
      await applyGamificationEvent({
        entityType: GamificationEntityType.PRODUCT,
        entityId: subscription.planId,
        tenantId: tenantIdForPayment,
        kind: "product.payment.approved",
        moneyInCents: paymentRecord.amountInCents,
        statusDelta: GAMIFICATION_WEIGHTS.paymentApproved.status + moneyPts,
        lifetimeDelta: GAMIFICATION_WEIGHTS.paymentApproved.lifetime + moneyPts,
        metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
      }).catch((err) => {
        logger.warn({ err, paymentId: paymentRecord.id, planId: subscription.planId }, "processWompiEvent: fallo aplicando gamificación a producto por pago aprobado");
      });
    }
  } else if (becameFailed) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: paymentRecord.customerId,
      tenantId: tenantIdForPayment,
      kind: GAMIFICATION_EVENT_KINDS.PAYMENT_FAILED,
      moneyInCents: paymentRecord.amountInCents,
      metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
    }).catch((err) => {
      logger.warn({ err, paymentId: paymentRecord.id, customerId: paymentRecord.customerId }, "processWompiEvent: fallo aplicando gamificación a customer por pago fallido");
    });

    if (subscription?.planId) {
      await applyGamificationEvent({
        entityType: GamificationEntityType.PRODUCT,
        entityId: subscription.planId,
        tenantId: tenantIdForPayment,
        kind: "product.payment.failed",
        moneyInCents: paymentRecord.amountInCents,
        statusDelta: GAMIFICATION_WEIGHTS.paymentFailed.status,
        lifetimeDelta: GAMIFICATION_WEIGHTS.paymentFailed.lifetime,
        metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
      }).catch((err) => {
        logger.warn({ err, paymentId: paymentRecord.id, planId: subscription.planId }, "processWompiEvent: fallo aplicando gamificación a producto por pago fallido");
      });
    }
  }

  if (nextStatus === PaymentStatus.APPROVED && subscription) {
    const advancedTo = await db.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id: subscription.id },
        include: { plan: true }
      });
      if (!sub) return null;

      if (sub.currentCycle !== cycle) {
        logger.warn({ subscriptionId: sub.id, currentCycle: sub.currentCycle, paymentCycle: cycle }, "Cycle mismatch; not advancing");
        return null;
      }

      // Anchor next cutoff to the current cutoff (not last payment).
      const nextStart = sub.currentPeriodEndAt || sub.currentPeriodStartAt || sub.createdAt || paidAt;
      const nextEnd = addIntervalUtc(nextStart, sub.plan.intervalUnit, sub.plan.intervalCount);
      const nextRunAt =
        sub.plan.intervalUnit === "MONTH"
          ? computeBillingCycleDueAt({
              periodStartAt: nextStart,
              periodEndAt: nextEnd,
              cycleStartDay: Math.max(1, Math.min(31, Math.trunc(sub.cycleStartDay || 1))),
              paymentDay: Math.max(1, Math.min(31, Math.trunc(sub.paymentDay || 1))),
              paymentTiming: sub.paymentTiming === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO"
            })
          : nextEnd;

      const updated = await tx.subscription.updateMany({
        where: { id: sub.id, currentCycle: sub.currentCycle },
        data: {
          status: SubscriptionStatus.ACTIVE,
          retryCount: 0,
          currentCycle: { increment: 1 },
          currentPeriodStartAt: nextStart,
          currentPeriodEndAt: nextEnd
        }
      });

      if (updated.count === 0) {
        logger.warn({ subscriptionId: sub.id }, "Subscription already advanced (idempotent)");
        return null;
      } else {
        logger.info({ subscriptionId: sub.id, nextEnd }, "Subscription advanced after payment approval");
        const collectionMode = resolveSubscriptionCollectionMode(sub);

        // PROGRAMACIÓN AL EVENTO: Agendar el Job exactamente para la fecha del próximo corte.
        if (collectionMode === "AUTO_DEBIT" || collectionMode === "AUTO_LINK") {
          await ensurePaymentRetryJob({
            subscriptionId: sub.id,
            runAt: nextRunAt,
            maxAttempts: 1,
            db: tx
          }).catch((err) => {
            logger.warn({ err, subscriptionId: sub.id }, "Fallo agendando próximo cobro tras avance de periodo");
          });
        }
        return { nextEnd, nextRunAt };
      }

    });

    // Notificaciones: la confirmación de pago se maneja por reglas (PAYMENT_APPROVED).
    if (advancedTo) {
      await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch((err) => {
        logger.warn({ err, subscriptionId: subscription.id }, "Fallo reprogramando recordatorios tras pago aprobado");
      });
    }
  }
  } finally {
    await db.$queryRaw`SELECT pg_advisory_unlock(hashtext(${lockKey}))`.catch((err) => {
      logger.warn({ err, webhookEventId }, "processWompiEvent: fallo liberando advisory lock");
    });
  }
}
export async function processWompiEvent(webhookEventId: string) {
  return processWompiEventLogic(webhookEventId, prisma);
}

export async function forwardWompiToShopify(webhookEventId: string) {
  const cfg = await getShopifyForward();
  if (!cfg.url) return;

  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return;

  const raw = (event.payload && typeof event.payload === "object"
    ? event.payload
    : {}) as { signature?: { checksum?: string } } & Record<string, unknown>;
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>).data : undefined;
  const transaction = data && typeof data === "object" ? (data as Record<string, unknown>).transaction : undefined;
  const dataRecord = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const txRecord = transaction && typeof transaction === "object" ? (transaction as Record<string, unknown>) : null;
  const checksum = String(event.checksum || raw?.signature?.checksum || "").trim();
  const origin = cfg.origin === "shopify-native" ? "shopify-native" : "shopify";
  const normalizeRef = (value: unknown) => (value == null ? "" : String(value).trim());
  const transactionId = normalizeRef(txRecord?.id);
  const paymentLinkId =
    normalizeRef(txRecord?.payment_link_id) ||
    normalizeRef((txRecord?.payment_link as Record<string, unknown> | undefined)?.id) ||
    normalizeRef((dataRecord as Record<string, unknown> | null)?.payment_link_id);
  let reference = normalizeRef(txRecord?.reference || dataRecord?.reference || (raw as Record<string, unknown>)?.reference);
  if (!reference) {
    if (transactionId) {
      const payment = await prisma.payment.findFirst({
        where: { wompiTransactionId: transactionId },
        select: { reference: true }
      });
      reference = normalizeRef(payment?.reference);
    }
    if (!reference && paymentLinkId) {
      const payment = await prisma.payment.findFirst({
        where: { wompiPaymentLinkId: paymentLinkId },
        select: { reference: true }
      });
      reference = normalizeRef(payment?.reference);
    }
  }
  if (!reference) {
    await systemLog(
      LogLevel.ERROR,
      "shopify.forward",
      "Forward skipped (missing reference)",
      {
        webhookEventId,
        transactionId: transactionId || null,
        paymentLinkId: paymentLinkId || null,
        url: cfg.url
      },
      "webhook:wompi"
    ).catch((err) => {
      logger.warn({ err, webhookEventId, transactionId, paymentLinkId }, "processWompiEvent: fallo escribiendo systemLog de forward sin referencia");
    });
    return;
  }
  const normalizedTx =
    transaction && typeof transaction === "object"
      ? {
          ...txRecord,
          origin: txRecord?.origin ?? origin,
          ...(reference && !txRecord?.reference ? { reference } : {})
        }
      : transaction;
  const normalizedData =
    data && typeof data === "object"
      ? {
          ...dataRecord,
          origin: dataRecord?.origin ?? origin,
          ...(reference && !dataRecord?.reference ? { reference } : {}),
          transaction: normalizedTx
        }
      : data;
  const payload = {
    ...(raw && typeof raw === "object" ? raw : {}),
    origin: (raw as Record<string, unknown>)?.origin ?? origin,
    sent_at: (raw as Record<string, unknown>)?.sent_at ?? new Date().toISOString(),
    ...(reference && !(raw as Record<string, unknown>)?.reference ? { reference } : {}),
    data: normalizedData
  };

  const res = await postJson(cfg.url, payload, {
    "x-forwarded-by": "wompi-subs-api",
    ...(checksum ? { "x-event-checksum": checksum, "x-wompi-checksum": checksum } : {}),
    ...(cfg.secret ? { "x-forwarded-secret": cfg.secret } : {})
  });

  if (!res.ok) {
    const bodyText = res.text || "";
    await systemLog(LogLevel.ERROR, "shopify.forward", "Forward failed", {
      webhookEventId,
      status: res.status,
      body: bodyText.slice(0, 2000),
      url: cfg.url
    }, "webhook:wompi").catch((err) => {
      logger.warn({ err, webhookEventId, status: res.status }, "processWompiEvent: fallo escribiendo systemLog de Shopify forward fallido");
    });
    throw new Error(`forward failed: ${res.status} ${bodyText}`);
  }
}
