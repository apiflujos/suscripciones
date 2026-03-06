import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { systemLog } from "../../services/systemLog";
import { GamificationEntityType, LogLevel, Prisma, type Subscription } from "@prisma/client";
import { classifyReference } from "../../webhooks/wompi/classifyReference";
import { postJson } from "../../lib/http";
import { PaymentLinkStatus, PaymentStatus, SubscriptionStatus, WebhookProcessStatus } from "@prisma/client";
import { addIntervalUtc } from "../../lib/dates";
import { getShopifyForward, getWompiCheckoutLinkBaseUrl } from "../../services/runtimeConfig";
import { schedulePaymentStatusNotifications, scheduleSubscriptionDueNotifications } from "../../services/notificationsScheduler";
import { consumeApp } from "../../services/superAdminApp";
import { syncChatwootAttributesForCustomer } from "../../services/chatwootSync";
import { getDefaultTenantId } from "../../services/tenantContext";
import { applyGamificationEvent, GAMIFICATION_EVENT_KINDS } from "../../services/gamification";
import { GAMIFICATION_WEIGHTS, moneyToPoints } from "../../services/gamificationConfig";
import { resolveSubscriptionCollectionMode } from "../../services/subscriptionMode";
import { ensurePaymentRetryJob } from "../../services/retryJobScheduler";
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
  });
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
  `.then(rows => Boolean(rows?.[0]?.locked)).catch(() => false);

  if (!lockAcquired) {
    logger.info({ webhookEventId }, "Webhook processing already in progress (lock skip)");
    return;
  }

  try {
    const event = await db.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) return;
    if (event.processStatus === WebhookProcessStatus.PROCESSED) return;

  const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as WompiPayload;
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
  
  const missingPaymentLinkRecord = Boolean(paymentLinkId && !paymentByLink && !paymentLinkRecord);
  const likelyExternalRefOnly = !paymentMatched && !paymentLinkRecord && referenceClassification.kind === "unknown" && !isInternalReference(reference);
  if (missingPaymentLinkRecord && !likelyExternalRefOnly) {
    await warnOnceWithDedupe({
      source: "processWompiEvent",
      message: "payment_link_not_found: proceeding by inference",
      dedupeKey: `${String(paymentLinkId || "sin_link")}|${String(reference || "sin_ref")}`,
      context: { paymentLinkId, reference },
      windowMinutes: 360
    }).catch(() => {});
  }

  let missingReferenceSubscriptionId = "";
  if (referenceClassification.kind === "subscription" && inferredSubscriptionId && !paymentMatched) {
    const exists = await db.subscription.findUnique({
      where: { id: inferredSubscriptionId },
      select: { id: true }
    });
    if (!exists) {
      missingReferenceSubscriptionId = String(referenceClassification.subscriptionId || inferredSubscriptionId || "");
      inferredSubscriptionId = "";
    }
  }

  const inferSubscriptionByCustomerIdentity = async () => {
    const tenantScope = event.tenantId ? { tenantId: event.tenantId } : {};
    const email = getCustomerEmailFromPayload(payload);
    const phone = getCustomerPhoneFromPayload(payload);
    const name = getCustomerNameFromPayload(payload);
    const nameNorm = normalizeNameForMatch(name);
    const customerIds = new Set<string>();

    if (email) {
      const byEmail = await db.customer.findMany({
        where: { email, ...tenantScope },
        select: { id: true }
      });
      byEmail.forEach((c) => customerIds.add(c.id));
    }

    if (phone) {
      const byPhone = await db.customer.findMany({
        where: { phone: { not: null }, ...tenantScope },
        select: { id: true, phone: true },
        orderBy: { updatedAt: "desc" },
        take: 500
      });
      byPhone.filter((c) => phonesMatch(c.phone, phone)).forEach((c) => customerIds.add(c.id));
    }

    if (customerIds.size === 0 && nameNorm.length >= 4) {
      const byName = await db.customer.findMany({
        where: { name: { contains: String(name || "").trim(), mode: "insensitive" }, ...tenantScope },
        select: { id: true, name: true },
        orderBy: { updatedAt: "desc" },
        take: 100
      });
      byName.filter((c) => normalizeNameForMatch(c.name) === nameNorm).forEach((c) => customerIds.add(c.id));
    }

    if (!customerIds.size) return { subscriptionId: "", reason: "identity_not_found" };
    const candidates = await db.subscription.findMany({
      where: {
        customerId: { in: Array.from(customerIds) },
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED] },
        ...(event.tenantId ? { tenantId: event.tenantId } : {})
      },
      include: {
        plan: {
          select: {
            priceInCents: true,
            currency: true,
            metadata: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }]
    });

    if (candidates.length === 1) return { subscriptionId: candidates[0].id, reason: "identity_unique" };
    if (!candidates.length) return { subscriptionId: "", reason: "subscription_not_found_for_identity" };

    const incomingAmount = Number(amountInCents || 0);
    const incomingCurrency = String(currency || "").trim().toUpperCase();
    const withExactAmount = candidates.filter((s: any) => {
      const planAmount = readSubscriptionPricingTotalInCents(s?.metadata, s?.plan?.priceInCents || 0);
      const planCurrency = String(s?.plan?.currency || "").trim().toUpperCase();
      if (!incomingAmount || !incomingCurrency) return false;
      return planAmount === incomingAmount && (!planCurrency || planCurrency === incomingCurrency);
    });
    if (withExactAmount.length === 1) {
      return { subscriptionId: withExactAmount[0].id, reason: "identity_amount_unique" };
    }

    if (withExactAmount.length > 1) {
      return { subscriptionId: "", reason: "subscription_ambiguous_for_identity", count: withExactAmount.length };
    }

    return { subscriptionId: "", reason: "subscription_not_found_for_identity", count: candidates.length };
  };

  if (!paymentMatched && !inferredSubscriptionId) {
    const inferred = await inferSubscriptionByCustomerIdentity();
    if (inferred.subscriptionId) {
      inferredSubscriptionId = inferred.subscriptionId;
      await systemLog(LogLevel.INFO, "processWompiEvent", "subscription_inferred_by_customer_identity", {
        reference,
        subscriptionId: inferred.subscriptionId,
        reason: inferred.reason
      }).catch(() => {});
    } else if (referenceClassification.kind === "subscription") {
      const missingSubId = missingReferenceSubscriptionId || referenceClassification.subscriptionId || null;
      await warnOnceWithDedupe({
        source: "processWompiEvent",
        message: "Referencia de suscripción no encontrada",
        dedupeKey: `${String(missingSubId || "sin_sub")}|${String(reference || "sin_ref")}`,
        context: {
          reference,
          subscriptionId: missingSubId,
          reason: inferred.reason
        },
        windowMinutes: 360
      }).catch(() => {});
      // No cortar el flujo: si no existe suscripción, crear/actualizar contacto y pago en fallback
      // para permitir conciliación manual posterior desde Pagos.
    }
  }

  const subscriptionId = inferredSubscriptionId;

  const isSubscription = !!subscriptionId;
  // Registrar pago y, si está aprobado, renovar ciclo (solo para suscripciones).
  const subscription =
    inferredSubscription ??
    (isSubscription ? await db.subscription.findUnique({ where: { id: subscriptionId } }) : null);
  if (isSubscription && !subscription) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "subscription not found", processedAt: new Date() }
    });
    return;
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
  const cycle = paymentMatched?.cycleNumber ?? cycleFromRef ?? (subscription?.currentCycle ?? 1);
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
      const fallbackMeta: Record<string, unknown> = { source: "wompi_webhook_fallback" };
      if (email) fallbackMeta.incomingEmail = email;
      if (emailConflictOtherTenant) fallbackMeta.emailTenantConflict = true;
      customer = await db.customer.create({
        data: {
          tenantId: tenantIdFallback,
          email: emailConflictOtherTenant ? null : email ?? null,
          name: getCustomerNameFromPayload(payload),
          phone,
          metadata: fallbackMeta as Prisma.InputJsonValue
        }
      });
    }

    const fallbackReference = reference ?? (transactionId ? `WOMPI_${transactionId}` : `WOMPI_WEBHOOK_${webhookEventId}`);
    const fallbackCurrency = String(currency || "COP").trim().toUpperCase() || "COP";
    const fallbackStatus = nextStatus ?? PaymentStatus.PENDING;

    if (transactionId) {
      paymentResolved = await db.payment.upsert({
        where: { wompiTransactionId: transactionId },
        create: {
          tenantId: tenantIdFallback,
          customerId: customer.id,
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
          providerResponse: { webhook: payload } as Prisma.InputJsonValue
        },
        update: {
          tenantId: tenantIdFallback,
          customerId: customer.id,
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
          providerResponse: { webhook: payload } as Prisma.InputJsonValue
        }
      });
    } else if (paymentLinkId) {
      paymentResolved = await db.payment.upsert({
        where: { wompiPaymentLinkId: paymentLinkId },
        create: {
          tenantId: tenantIdFallback,
          customerId: customer.id,
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
          providerResponse: { webhook: payload } as Prisma.InputJsonValue
        },
        update: {
          tenantId: tenantIdFallback,
          customerId: customer.id,
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
          providerResponse: { webhook: payload } as Prisma.InputJsonValue
        }
      });
    } else {
      paymentResolved = await db.payment.create({
        data: {
          tenantId: tenantIdFallback,
          customerId: customer.id,
          amountInCents: amountInCents ?? 0,
          currency: fallbackCurrency,
          reference: fallbackReference,
          status: fallbackStatus,
          paidAt: fallbackStatus === PaymentStatus.APPROVED ? paidAt : null,
          failedAt:
            fallbackStatus === PaymentStatus.APPROVED || fallbackStatus === PaymentStatus.PENDING
              ? null
              : computedFailedAt,
          providerResponse: { webhook: payload } as Prisma.InputJsonValue
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
    }).catch(() => {});
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
          providerResponse:
            paymentResolved.providerResponse && typeof paymentResolved.providerResponse === "object"
              ? ({ ...(paymentResolved.providerResponse as Record<string, unknown>), webhook: payload } as Prisma.InputJsonValue)
              : ({ webhook: payload } as Prisma.InputJsonValue),
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
          providerResponse: { webhook: payload } as Prisma.InputJsonValue,
          reference: reference ?? undefined,
          ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
          wompiPaymentLinkId: paymentLinkId ?? undefined
        }
      });

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
        .catch(() => {});
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
  }).catch(() => {});

  await db.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processStatus: WebhookProcessStatus.PROCESSED, processedAt: new Date() }
  });

  await schedulePaymentStatusNotifications({ paymentId: paymentRecord.id, forceNow: true }).catch((err) => {
    systemLog(LogLevel.ERROR, "notifications.payment_status", "Fallo al programar notificaciones de pago", {
      paymentId: paymentRecord.id,
      error: String(err?.message || err)
    }).catch(() => {});
  });
  await syncChatwootAttributesForCustomer(paymentRecord.customerId).catch((err) => {
    systemLog(LogLevel.WARN, "chatwoot.sync", "Fallo al sincronizar atributos de Chatwoot", {
      customerId: paymentRecord.customerId,
      error: String(err?.message || err)
    }).catch(() => {});
  });

  const becameApproved = !wasApproved && nextStatus === PaymentStatus.APPROVED;
  const becameFailed = !wasFailed && (nextStatus === PaymentStatus.DECLINED || nextStatus === PaymentStatus.ERROR || nextStatus === PaymentStatus.VOIDED);
  if (becameApproved) {
    await consumeApp("payments_success", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
  } else if (becameFailed) {
    await consumeApp("payments_failed", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
  }

  if (becameApproved) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: paymentRecord.customerId,
      tenantId: tenantIdForPayment,
      kind: GAMIFICATION_EVENT_KINDS.PAYMENT_APPROVED,
      moneyInCents: paymentRecord.amountInCents,
      metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
    }).catch(() => {});

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
      }).catch(() => {});
    }
  } else if (becameFailed) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: paymentRecord.customerId,
      tenantId: tenantIdForPayment,
      kind: GAMIFICATION_EVENT_KINDS.PAYMENT_FAILED,
      moneyInCents: paymentRecord.amountInCents,
      metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
    }).catch(() => {});

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
      }).catch(() => {});
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

      const meta: any = (sub.metadata ?? {}) as any;
      const manualCharge = meta?.manualCharge;
      const manualCycle = manualCharge && typeof manualCharge === "object" ? Number(manualCharge.cycle ?? NaN) : NaN;
      const manualAtRaw = manualCharge && typeof manualCharge === "object" ? String(manualCharge.at || "") : "";
      const manualAt = manualAtRaw ? new Date(manualAtRaw) : null;
      const useManualAnchor = Number.isFinite(manualCycle) && manualCycle === cycle && manualAt && !Number.isNaN(manualAt.getTime());

      // Always anchor next cutoff to the latest approved payment persisted in DB.
      const latestApproved = await tx.payment.findFirst({
        where: { subscriptionId: sub.id, status: PaymentStatus.APPROVED },
        orderBy: [{ paidAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
        select: { paidAt: true, updatedAt: true, createdAt: true }
      });
      const latestApprovedAt = latestApproved?.paidAt || latestApproved?.updatedAt || latestApproved?.createdAt || null;
      const nextStart = useManualAnchor ? manualAt! : (latestApprovedAt || paidAt || sub.currentPeriodEndAt);
      const nextEnd = addIntervalUtc(nextStart, sub.plan.intervalUnit, sub.plan.intervalCount);

      const nextMeta = useManualAnchor
        ? (() => {
            const copy: any = meta && typeof meta === "object" ? { ...meta } : {};
            delete copy.manualCharge;
            return copy;
          })()
        : null;

      const updated = await tx.subscription.updateMany({
        where: { id: sub.id, currentCycle: sub.currentCycle },
        data: {
          status: SubscriptionStatus.ACTIVE,
          retryCount: 0,
          currentCycle: { increment: 1 },
          currentPeriodStartAt: nextStart,
          currentPeriodEndAt: nextEnd,
          ...(useManualAnchor ? { metadata: nextMeta as Prisma.InputJsonValue } : {})
        }
      });

      if (updated.count === 0) {
        logger.warn({ subscriptionId: sub.id }, "Subscription already advanced (idempotent)");
        return null;
      } else {
        logger.info({ subscriptionId: sub.id, nextEnd }, "Subscription advanced after payment approval");
        const collectionMode = resolveSubscriptionCollectionMode(sub);
        // Single attempt at next cutoff (no retries).
        if (collectionMode === "AUTO_LINK") {
          await ensurePaymentRetryJob({
            subscriptionId: sub.id,
            runAt: nextEnd <= new Date(Date.now() + 5_000) ? new Date() : nextEnd,
            maxAttempts: 1,
            db: tx
          }).catch(() => {});
        } else if (collectionMode === "AUTO_DEBIT") {
          await ensurePaymentRetryJob({
            subscriptionId: sub.id,
            runAt: nextEnd,
            maxAttempts: 1,
            db: tx
          }).catch(() => {});
        }
        return nextEnd;
      }
    });

    // Notificaciones: la confirmación de pago se maneja por reglas (PAYMENT_APPROVED).
          if (advancedTo) {
          await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});
        }
      }
      } finally {
        await db.$queryRaw`SELECT pg_advisory_unlock(hashtext(${lockKey}))`.catch(() => {});
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
  const payload = {
    ...(raw && typeof raw === "object" ? raw : {}),
    origin: (raw as Record<string, unknown>)?.origin ?? origin,
    sent_at: (raw as Record<string, unknown>)?.sent_at ?? new Date().toISOString(),
    data:
      data && typeof data === "object"
        ? {
            ...dataRecord,
            origin: dataRecord?.origin ?? origin,
            transaction:
              transaction && typeof transaction === "object"
                ? { ...txRecord, origin: txRecord?.origin ?? origin }
                : transaction
          }
        : data
  };

  const res = await postJson(cfg.url, payload, {
    "x-forwarded-by": "wompi-subs-api",
    ...(checksum ? { "x-event-checksum": checksum, "x-wompi-checksum": checksum } : {}),
    ...(cfg.secret ? { "x-forwarded-secret": cfg.secret } : {})
  });

  if (!res.ok) {
    const bodyText = res.text || "";
    const looksLikeSoftFail = res.status >= 500 && /internal server error/i.test(bodyText) && /"success"\s*:\s*false/i.test(bodyText);
    if (looksLikeSoftFail) {
      await systemLog(LogLevel.WARN, "shopify.forward", "Forward returned 5xx but treated as accepted", {
        webhookEventId,
        status: res.status,
        body: bodyText.slice(0, 2000),
        url: cfg.url
      }).catch(() => {});
      return;
    }
    await systemLog(LogLevel.ERROR, "shopify.forward", "Forward failed", {
      webhookEventId,
      status: res.status,
      body: bodyText.slice(0, 2000),
      url: cfg.url
    }).catch(() => {});
    throw new Error(`forward failed: ${res.status} ${bodyText}`);
  }
}
