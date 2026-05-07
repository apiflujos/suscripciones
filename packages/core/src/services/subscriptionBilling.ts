import { CredentialProvider, LogLevel, PaymentLinkStatus, PaymentStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { systemLog } from "./systemLog";
import { syncChatwootAttributesForCustomer } from "./chatwootSync";
import { readCheckoutConfig } from "./checkoutConfig";
import { getCredential } from "./credentials";
import { firstNotificationDeliveryError } from "./notificationDelivery";
import { logger } from "../lib/logger";
import { buildWompiTransactionSignature, validateWompiCurrency } from "../lib/wompiSignature";
import { toUtc } from "../lib/dates";
import {
  getAutoDebitConfig,
  getChatwootConfig,
  getWompiApiBaseUrl,
  getWompiCheckoutLinkBaseUrl,
  getWompiIntegritySecret,
  getWompiPrivateKey,
  getWompiPublicKey,
  getWompiRedirectUrl
} from "./runtimeConfig";
import { getNotificationsConfig, resolveNotificationTemplate } from "./notificationsConfig";
import { schedulePaymentLinkNotifications } from "./notificationsScheduler";
import { publishRealtime } from "./realtimePublisher";
import { resolveSubscriptionCollectionMode } from "./subscriptionMode";
import { resolveEffectiveSubscriptionAutomationConfig } from "./subscriptionAutomationConfig";
import { reconcileWompiTransaction } from "./wompiReconcile";
import { getExpectedSubscriptionTotalInCents, getPlanCollectionMode } from "../lib/metadataSchemas";
import { isBillingCyclePaid, resolveSubscriptionBillingState } from "./billingCycles";
import { createPublicCheckoutLink } from "./publicCheckoutLinks";
import { extractCustomerPaymentSourceId } from "../lib/customerMetadata";

const PAYMENT_LINK_LOCK_PREFIX = "payment-link";
const AUTO_DEBIT_LOCK_PREFIX = "auto-debit";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const logIgnored = (err: unknown, message: string, context?: Record<string, unknown>) => {
  logger.warn({ err, ...(context || {}) }, message);
};

type PlanMetadata = {
  collectionMode?: string;
};

type SubscriptionMetadata = {
  templateId?: string;
  pricing?: {
    totalInCents?: number;
    currency?: string;
  };
};

type TemplateProductRef = { id?: string } | string | null | undefined;

function readSubscriptionTemplateId(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  return String((metadata as SubscriptionMetadata).templateId || "").trim();
}

function readPlanCatalogItemId(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const catalog = (metadata as { catalog?: { itemId?: string } }).catalog;
  return String(catalog?.itemId || "").trim();
}

function readTemplateProductRefs(value: unknown): TemplateProductRef[] {
  return Array.isArray(value) ? (value as TemplateProductRef[]) : [];
}

function extractTemplateProductId(entry: TemplateProductRef): string {
  if (!entry) return "";
  if (typeof entry === "string") return String(entry).trim();
  if (typeof entry === "object") return String(entry.id || "").trim();
  return "";
}

function resolveSubscriptionProductId(args: {
  subscriptionProductId?: string | null;
  planCatalogProductId?: string | null;
  planMetadata?: unknown;
}): string | null {
  const direct = String(args.subscriptionProductId || "").trim();
  if (direct) return direct;
  const catalogProductId = String(args.planCatalogProductId || "").trim();
  if (catalogProductId) return catalogProductId;
  const fromMeta = readPlanCatalogItemId(args.planMetadata);
  return fromMeta || null;
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function tryAcquirePaymentLinkLock(key: string) {
  try {
    const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${key})) as locked
    `;
    return Boolean(rows?.[0]?.locked);
  } catch (err) {
    logger.warn({ err, key, error: getErrorMessage(err) }, '[PaymentLock] Failed to acquire lock');
    throw err; // Re-lanzar para que el caller sepa que falló
  }
}

async function releasePaymentLinkLock(key: string) {
  try {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(hashtext(${key}))
    `;
  } catch (err) {
    logger.warn({ err, key, error: getErrorMessage(err) }, '[PaymentLock] Failed to release lock');
  }
}

function formatCop(amountInCents: number | null | undefined) {
  const pesos = Math.trunc(Number(amountInCents ?? 0) / 100);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

function formatPeriodicity(intervalUnit: string, intervalCount: number) {
  const count = Number(intervalCount || 1);
  const unit = String(intervalUnit || "MONTH").toUpperCase();
  if (unit === "DAY") return count === 1 ? "diaria" : `cada ${count} días`;
  if (unit === "WEEK") return count === 1 ? "semanal" : `cada ${count} semanas`;
  if (unit === "MONTH") return count === 1 ? "mensual" : `cada ${count} meses`;
  return count === 1 ? "periódica" : `cada ${count} periodos`;
}

function replaceVars(input: string, vars: Record<string, string>) {
  return input
    .replaceAll("{contacto}", vars.contacto)
    .replaceAll("{producto}", vars.producto)
    .replaceAll("{monto}", vars.monto)
    .replaceAll("{periodicidad}", vars.periodicidad)
    .replaceAll("{fecha_expira}", vars.fecha_expira);
}

async function resolvePlanCheckoutTemplateId(args: {
  tenantId: string;
  subscriptionMetadata?: unknown;
  planMetadata?: unknown;
}): Promise<string | null> {
  const tenantId = String(args.tenantId || "").trim();
  if (!tenantId) return null;

  const explicitTemplateId = readSubscriptionTemplateId(args.subscriptionMetadata);
  if (explicitTemplateId) {
    const explicit = await prisma.publicCheckoutTemplate.findUnique({ where: { id: explicitTemplateId } }).catch(() => null);
    if (explicit && explicit.active !== false && String(explicit.kind || "").toUpperCase() === "PLAN") {
      return String(explicit.id);
    }
  }

  const productId = readPlanCatalogItemId(args.planMetadata);
  const templates = await prisma.publicCheckoutTemplate.findMany({
    where: { tenantId, active: true, kind: "PLAN" },
    orderBy: { updatedAt: "desc" }
  });
  if (!templates.length) return null;

  if (productId) {
    const match = templates.find((t) => {
      const list = readTemplateProductRefs((t as { productIds?: unknown }).productIds);
      return list.some((entry) => String(extractTemplateProductId(entry)) === productId);
    });
    if (match?.id) return String(match.id);
  }

  try {
    const rawCfg = await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG");
    const cfg = readCheckoutConfig(rawCfg);
    const defaultTemplateId = String(cfg?.defaultPlanTemplateId || "").trim();
    if (!defaultTemplateId) return null;
    const fallback = templates.find((t) => String(t.id || "").trim() === defaultTemplateId) || null;
    return fallback?.id ? String(fallback.id) : null;
  } catch {
    return null;
  }
}

async function hasUsableSubscriptionPaymentLinkNotification(): Promise<boolean> {
  try {
    const cfg = await getNotificationsConfig();
    const template = resolveNotificationTemplate({
      rules: cfg.rules,
      templates: cfg.templates,
      trigger: "PAYMENT_LINK_CREATED",
      paymentType: "SUBSCRIPTION"
    });
    return Boolean(
      template &&
        String(template.channel || "").toUpperCase() === "CHATWOOT" &&
        String(template.chatwootTemplate?.name || "").trim()
    );
  } catch {
    return false;
  }
}

export function readSubscriptionTotalInCents(subscriptionMeta: unknown, fallback: number, planMeta?: unknown): number {
  return getExpectedSubscriptionTotalInCents({
    subscriptionMetadata: subscriptionMeta,
    planMetadata: planMeta,
    fallback
  });
}

/**
 * Determines if a subscription should be considered past due.
 * RULE: If the most recent cycle is paid, subscription is ACTIVE even if older cycles are overdue.
 */
function shouldMarkSubscriptionPastDue(args: {
  mostRecentCycle: { paymentId?: string | null; dueAt: Date; status?: string | null } | null;
  graceDays: number;
  asOf: Date;
}) {
  const cycle = args.mostRecentCycle;
  if (!cycle) return { shouldMark: false, reason: "no_cycle" };

  // KEY RULE: subscription is ACTIVE only when the most recent cycle is actually PAID.
  if (isBillingCyclePaid(cycle)) return { shouldMark: false, reason: "most_recent_cycle_is_paid" };

  const dueWithGraceAt = new Date(cycle.dueAt.getTime() + Math.max(0, Math.trunc(args.graceDays || 0)) * 24 * 60 * 60 * 1000);
  if (dueWithGraceAt.getTime() >= args.asOf.getTime()) {
    return { shouldMark: false, reason: "within_due_or_grace_period" };
  }

  return { shouldMark: true, reason: "most_recent_cycle_overdue" };
}

export async function ensureExpiredSubscriptions() {
  const now = new Date();
  const candidates = await prisma.subscription.findMany({
    where: {
      status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED] }
    },
    select: {
      id: true,
      status: true,
      graceDays: true,
      maxRetries: true,
      metadata: true
    }
  });
  let toPastDue = 0;
  let toSuspended = 0;
  let toCanceled = 0;
  let recoveredToActive = 0;

  for (const sub of candidates) {
    const automation = await resolveEffectiveSubscriptionAutomationConfig(sub).catch(() => null);
    const graceDays = Math.max(0, Math.trunc(Number(automation?.graceDays ?? 5)));
    const suspendDays = Math.max(0, Math.trunc(Number(automation?.suspendDays ?? 15)));
    const cancelDays = Math.max(0, Math.trunc(Number(automation?.cancelDays ?? 30)));
    const billingState = await resolveSubscriptionBillingState({ subscriptionId: sub.id }).catch(() => null);
    const collectionCycle = billingState?.collectionCycle || billingState?.activeCycle || null;

    // Check if subscription should be PAST_DUE
    const pastDueCheck = shouldMarkSubscriptionPastDue({
      mostRecentCycle: collectionCycle,
      graceDays,
      asOf: now
    });

    // CRITICAL: If most recent cycle is paid but subscription is PAST_DUE, recover to ACTIVE
    if (
      (sub.status === SubscriptionStatus.PAST_DUE || sub.status === SubscriptionStatus.SUSPENDED) &&
      isBillingCyclePaid(collectionCycle)
    ) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.ACTIVE, suspendedAt: null, canceledAt: null }
      });
      recoveredToActive += 1;
      continue;
    }

    if (sub.status === SubscriptionStatus.ACTIVE && pastDueCheck.shouldMark) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.PAST_DUE }
      });
      toPastDue += 1;
      continue;
    }

    const dueAt = new Date(collectionCycle?.dueAt || now);
    const suspendedCutoff = new Date(
      dueAt.getTime() + (graceDays + suspendDays) * 24 * 60 * 60 * 1000
    );
    if (sub.status === SubscriptionStatus.PAST_DUE && suspendedCutoff.getTime() < now.getTime() && !isBillingCyclePaid(collectionCycle)) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.SUSPENDED, suspendedAt: now }
      });
      toSuspended += 1;
      continue;
    }

    const canceledCutoff = new Date(suspendedCutoff.getTime() + cancelDays * 24 * 60 * 60 * 1000);
    if (sub.status === SubscriptionStatus.SUSPENDED && canceledCutoff.getTime() < now.getTime() && !isBillingCyclePaid(collectionCycle)) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.CANCELED, canceledAt: now, suspendedAt: null }
      });
      toCanceled += 1;
    }
  }

  if (toPastDue > 0 || toSuspended > 0 || toCanceled > 0 || recoveredToActive > 0) {
    await systemLog(LogLevel.INFO, "subscriptions.lifecycle", "Limpieza de estados de suscripciones", {
      markedPastDue: toPastDue,
      markedSuspended: toSuspended,
      markedCanceled: toCanceled,
      recoveredToActive
    }).catch((err: any) => {
      logIgnored(err, "subscription lifecycle: failed to write cleanup log", {
        toPastDue,
        toSuspended,
        toCanceled,
        recoveredToActive
      });
    });
  }
}

export async function handleSubscriptionPaymentFailure(subscriptionId: string, error: string) {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      status: true,
      graceDays: true,
      maxRetries: true,
      metadata: true
    }
  });
  if (!sub || sub.status === SubscriptionStatus.CANCELED || sub.status === SubscriptionStatus.EXPIRED) return;
  const automation = await resolveEffectiveSubscriptionAutomationConfig(sub).catch(() => null);
  const graceDays = Math.max(0, Math.trunc(Number(automation?.graceDays ?? 5)));

  const billingState = await resolveSubscriptionBillingState({ subscriptionId: sub.id }).catch(() => null);
  const mostRecentCycle = billingState?.collectionCycle || billingState?.activeCycle || null;

  // KEY RULE: If most recent cycle is paid, don't mark subscription as PAST_DUE
  if (isBillingCyclePaid(mostRecentCycle)) {
    await systemLog(LogLevel.WARN, "subscriptions.lifecycle", "Cobro falló pero el ciclo más reciente está pagado", {
      subscriptionId,
      error,
      mostRecentCycle: mostRecentCycle?.cycleNumber ?? null,
      currentStatus: sub.status
    }).catch((err: any) => {
      logIgnored(err, "subscription lifecycle: failed to write grace-period failure log", { subscriptionId });
    });
    return;
  }

  if (!mostRecentCycle) return;

  const dueWithGraceAt = new Date(mostRecentCycle.dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
  if (dueWithGraceAt.getTime() >= Date.now()) {
    await systemLog(LogLevel.WARN, "subscriptions.lifecycle", "Cobro falló pero la suscripción sigue dentro de gracia", {
      subscriptionId,
      error,
      dueAt: mostRecentCycle.dueAt.toISOString(),
      dueWithGraceAt: dueWithGraceAt.toISOString(),
      currentStatus: sub.status
    }).catch((err: any) => {
      logIgnored(err, "subscription lifecycle: failed to write grace-period failure log", { subscriptionId });
    });
    return;
  }

  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubscriptionStatus.PAST_DUE }
  });

  await systemLog(LogLevel.ERROR, "subscriptions.lifecycle", "Suscripción marcada como PAST_DUE tras fallo de cobro", {
    subscriptionId,
    error,
    dueAt: mostRecentCycle.dueAt.toISOString(),
    dueWithGraceAt: dueWithGraceAt.toISOString(),
    previousStatus: sub.status
  }).catch((err: any) => {
    logIgnored(err, "subscription lifecycle: failed to write past_due log", { subscriptionId });
  });
}

export async function createPaymentLinkForSubscription(args: {
  subscriptionId: string;
  amountInCentsOverride?: number;
  sendNotifications?: boolean;
}): Promise<{
  paymentId: string;
  wompiPaymentLinkId: string;
  checkoutUrl: string;
  notificationsScheduled: number;
  notificationsSent: number;
  notificationsRulesActive: boolean;
  chatwootError: string | null;
}> {
  const emptyNotificationResult = {
    notificationsScheduled: 0,
    notificationsSent: 0,
    notificationsRulesActive: false,
    chatwootError: null
  };
  const sub = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { plan: true, customer: true }
  });
  if (!sub) throw new Error("subscription_not_found");
  const tenantId = sub.tenantId || sub.plan?.tenantId;
  if (!tenantId) throw new Error("tenant_required");
  if (sub.status === SubscriptionStatus.CANCELED) throw new Error("subscription_canceled");
  if (sub.status === SubscriptionStatus.SUSPENDED) throw new Error("subscription_suspended");
  if (sub.status === SubscriptionStatus.EXPIRED) throw new Error("subscription_expired");

  // FIX: Validar moneda antes de crear payment link
  const currency = validateWompiCurrency(sub.plan.currency);

  const billingState = await resolveSubscriptionBillingState({ subscriptionId: sub.id }).catch((err) => {
    logIgnored(err, "payment link: failed to resolve billing state", { subscriptionId: sub.id });
    return null;
  });
  const collectionCycle = billingState?.collectionCycle || null;
  if (isBillingCyclePaid(collectionCycle)) {
    throw new Error("payment_already_approved");
  }
  const cycle = collectionCycle?.cycleNumber ?? 1;
  let reference = `SUB_${sub.id}_${cycle}`;
  const amountInCents = args.amountInCentsOverride ?? readSubscriptionTotalInCents(sub.metadata, sub.plan.priceInCents, sub.plan.metadata);

  const subscriptionCycleKey = `${sub.id}:${cycle}`;
  const existingPayment = await prisma.payment.findUnique({
    where: { subscriptionCycleKey },
    select: {
      id: true,
      status: true,
      checkoutUrl: true,
      wompiPaymentLinkId: true
    }
  });
  if (existingPayment && existingPayment.status === PaymentStatus.APPROVED) {
    throw new Error("payment_already_approved");
  }
  const payment = await prisma.payment.upsert({
    where: { subscriptionCycleKey },
    create: {
      tenantId,
      customerId: sub.customerId,
      subscriptionId: sub.id,
      amountInCents,
      currency,
      cycleNumber: cycle,
      reference,
      status: PaymentStatus.PENDING,
      subscriptionCycleKey,
      origin: "AUTO_LINK",
      associationReason: "SUB_REF",
      associatedBy: "system"
    },
    update: {
      tenantId,
      customerId: sub.customerId,
      subscriptionId: sub.id,
      amountInCents,
      currency,
      cycleNumber: cycle,
      subscriptionCycleKey,
      origin: "AUTO_LINK",
      associationReason: "SUB_REF",
      associatedBy: "system",
      reference,
      status: PaymentStatus.PENDING
    }
  });

  if (payment.checkoutUrl && payment.wompiPaymentLinkId) {
    await prisma.paymentLink
      .upsert({
        where: { paymentId: payment.id },
        create: {
          tenantId,
          planId: sub.planId,
          subscriptionId: sub.id,
          paymentId: payment.id,
          wompiPaymentLinkId: payment.wompiPaymentLinkId,
          checkoutUrl: payment.checkoutUrl,
          status: payment.status === PaymentStatus.APPROVED ? PaymentLinkStatus.PAID : PaymentLinkStatus.SENT,
          sentAt: new Date(),
          paidAt: payment.paidAt ?? null
        },
        update: {
          tenantId,
          planId: sub.planId,
          subscriptionId: sub.id,
          wompiPaymentLinkId: payment.wompiPaymentLinkId,
          checkoutUrl: payment.checkoutUrl,
          paidAt: payment.paidAt ?? null,
          status: payment.status === PaymentStatus.APPROVED ? PaymentLinkStatus.PAID : undefined
        }
      })
      .catch((err) => {
        logIgnored(err, "payment link: failed to upsert existing link", { subscriptionId: sub.id, paymentId: payment.id });
      });
    return {
      paymentId: payment.id,
      wompiPaymentLinkId: payment.wompiPaymentLinkId,
      checkoutUrl: payment.checkoutUrl,
      ...emptyNotificationResult
    };
  }

  const lockKey = `${PAYMENT_LINK_LOCK_PREFIX}:${subscriptionCycleKey}`;
  const locked = await tryAcquirePaymentLinkLock(lockKey);
  if (!locked) {
    for (let attempt = 0; attempt < 4; attempt++) {
      await delay(250);
      const existing = await prisma.payment.findUnique({
        where: { id: payment.id },
        select: { checkoutUrl: true, wompiPaymentLinkId: true }
      });
      if (existing?.checkoutUrl && existing?.wompiPaymentLinkId) {
        return {
          paymentId: payment.id,
          wompiPaymentLinkId: existing.wompiPaymentLinkId,
          checkoutUrl: existing.checkoutUrl,
          ...emptyNotificationResult
        };
      }
    }
    await systemLog(LogLevel.WARN, "subscriptions.payment_link", "Payment link creation already in progress", {
      subscriptionId: sub.id,
      paymentId: payment.id
    }).catch((err) => {
      logIgnored(err, "payment link: failed to write system log", { subscriptionId: sub.id, paymentId: payment.id });
    });
    throw new Error("payment_link_in_progress");
  }

  let lockReleased = false;
  const releaseLock = async () => {
    if (lockReleased) return;
    lockReleased = true;
    await releasePaymentLinkLock(lockKey).catch((err) => {
      logIgnored(err, "payment link: failed to release advisory lock", { lockKey });
    });
  };

  let created: Awaited<ReturnType<WompiClient["createPaymentLink"]>>;
  let updated:
    | { id: string; checkoutUrl: string | null; wompiPaymentLinkId: string | null; status?: PaymentStatus; amountInCents?: number | null }
    | null = null;
  try {
    const existing = await prisma.payment.findUnique({
      where: { id: payment.id },
      select: { checkoutUrl: true, wompiPaymentLinkId: true }
    });
    if (existing?.checkoutUrl && existing?.wompiPaymentLinkId) {
      await releaseLock();
      return {
        paymentId: payment.id,
        wompiPaymentLinkId: existing.wompiPaymentLinkId,
        checkoutUrl: existing.checkoutUrl,
        ...emptyNotificationResult
      };
    }

    const privateKey = await getWompiPrivateKey();
    if (!privateKey) throw new Error("wompi_private_key_not_configured");

    const wompi = new WompiClient({
      apiBaseUrl: await getWompiApiBaseUrl(),
      privateKey,
      checkoutLinkBaseUrl: await getWompiCheckoutLinkBaseUrl()
    });

    try {
      const redirectUrl = await getWompiRedirectUrl();
      const periodicidad = formatPeriodicity(sub.plan.intervalUnit, sub.plan.intervalCount);
      const monto = formatCop(amountInCents);
      const cliente = sub.customer?.name || sub.customer?.email || "Cliente";
      const producto = sub.plan?.name || "Suscripción";
      const rawConfig = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
      const cfg = rawConfig ? readCheckoutConfig(rawConfig) : null;
      const collectionMode = resolveSubscriptionCollectionMode(sub);
      // Solo AUTO_DEBIT usa plantilla SUBSCRIPTION; MANUAL_LINK y AUTO_LINK usan PLAN
      const isPlan = collectionMode !== "AUTO_DEBIT";
      const baseTitle = String(isPlan ? cfg?.planTitle : cfg?.subscriptionTitle || "").trim();
      const baseDesc = String(isPlan ? cfg?.planDescription : cfg?.subscriptionDescription || "").trim();
      const templateId = readSubscriptionTemplateId(sub.metadata);
      const template =
        templateId
          ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } })
          : null;
      const templateOk =
        template &&
        String(template.kind || "").toUpperCase() === (isPlan ? "PLAN" : "SUBSCRIPTION")
          ? template
          : null;
      const templateTitle = String(templateOk?.publicTitle || templateOk?.wompiTitle || baseTitle || "").trim();
      const templateDesc = String(templateOk?.publicDescription || templateOk?.wompiDescription || baseDesc || "").trim();
      const vars = {
        contacto: cliente,
        producto,
        monto,
        periodicidad,
        fecha_expira: ""
      };
      const wompiTitle = templateTitle ? replaceVars(templateTitle, vars) : `${producto} · ${cliente}`;
      const wompiDescription = templateDesc ? replaceVars(templateDesc, vars) : `${producto} (${periodicidad}) · ${monto} · ciclo ${cycle}`;
      created = await wompi.createPaymentLink({
        name: wompiTitle,
        description: wompiDescription,
        single_use: true,
        collect_shipping: false,
        currency,
        amount_in_cents: amountInCents,
        redirect_url: redirectUrl,
        sku: payment.id
      });
    } catch (err) {
      const errMessage = getErrorMessage(err);
      await prisma.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          attemptNo: 0,
          status: "PAYMENT_LINK_CREATE_FAILED",
          provider: "wompi",
          errorMessage: errMessage
        }
      });
      await systemLog(LogLevel.ERROR, "subscriptions.payment_link", "Payment link create failed", {
        subscriptionId: sub.id,
        paymentId: payment.id,
        err: errMessage
      }).catch((logErr) => {
        logIgnored(logErr, "payment link: failed to write error system log", { subscriptionId: sub.id, paymentId: payment.id });
      });
      throw err;
    }

    await prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNo: 0,
        status: "PAYMENT_LINK_CREATED",
        provider: "wompi",
        response: created.raw
      }
    });

    updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        wompiPaymentLinkId: created.id,
        checkoutUrl: created.checkoutUrl
      }
    });
    const updatedPayment = updated ?? {
      id: payment.id,
      checkoutUrl: created.checkoutUrl,
      wompiPaymentLinkId: created.id
    };
    const updatedId = updatedPayment.id;

    await prisma.paymentLink
      .upsert({
        where: { paymentId: updatedPayment.id },
        create: {
          tenantId,
          planId: sub.planId,
          productId: resolveSubscriptionProductId({
            subscriptionProductId: sub.productId,
            planCatalogProductId: (sub.plan as { catalogProductId?: string | null })?.catalogProductId || null,
            planMetadata: sub.plan?.metadata
          }),
          subscriptionId: sub.id,
          paymentId: updatedPayment.id,
          wompiPaymentLinkId: created.id,
          checkoutUrl: updatedPayment.checkoutUrl || created.checkoutUrl,
          status: PaymentLinkStatus.SENT,
          sentAt: new Date()
        },
        update: {
          tenantId,
          planId: sub.planId,
          productId: resolveSubscriptionProductId({
            subscriptionProductId: sub.productId,
            planCatalogProductId: (sub.plan as { catalogProductId?: string | null })?.catalogProductId || null,
            planMetadata: sub.plan?.metadata
          }),
          subscriptionId: sub.id,
          wompiPaymentLinkId: created.id,
          checkoutUrl: updatedPayment.checkoutUrl || created.checkoutUrl
        }
      })
      .catch((err) => {
        logIgnored(err, "payment link: failed to upsert payment link", { subscriptionId: sub.id, paymentId: updatedId });
      });

    await systemLog(LogLevel.INFO, "subscriptions.payment_link", "Payment link created", {
      subscriptionId: sub.id,
      paymentId: updatedId,
      wompiPaymentLinkId: created.id
    }).catch((err) => {
      logIgnored(err, "payment link: failed to write system log", { subscriptionId: sub.id, paymentId: updatedId });
    });
    void publishRealtime("payments", {
      type: "payment_link_created",
      subscriptionId: sub.id,
      paymentId: updatedId,
      wompiPaymentLinkId: created.id,
      status: updated?.status || PaymentStatus.PENDING,
      amountInCents: updated?.amountInCents,
      customerId: sub.customerId,
      checkoutUrl: updated?.checkoutUrl || created.checkoutUrl || null,
      createdAt: new Date().toISOString()
    });
  } finally {
    await releaseLock();
  }

  if (!updated || !created) {
    throw new Error("payment_link_not_created");
  }

  if (args.sendNotifications === false) {
    if (!updated.checkoutUrl) throw new Error("checkout_url_missing");
    return {
      paymentId: updated.id,
      wompiPaymentLinkId: created.id,
      checkoutUrl: updated.checkoutUrl,
      ...emptyNotificationResult
    };
  }

  const shouldNotify = await hasUsableSubscriptionPaymentLinkNotification();
  if (!shouldNotify) {
    if (!updated.checkoutUrl) throw new Error("checkout_url_missing");
    return {
      paymentId: updated.id,
      wompiPaymentLinkId: created.id,
      checkoutUrl: updated.checkoutUrl,
      ...emptyNotificationResult
    };
  }

  const publicTemplateId = await resolvePlanCheckoutTemplateId({
    tenantId,
    subscriptionMetadata: sub.metadata,
    planMetadata: sub.plan?.metadata
  }).catch(() => null);
  if (!publicTemplateId) {
    throw new Error("missing_checkout_for_product");
  }

  const publicCheckout = await createPublicCheckoutLink({
    customerId: sub.customerId,
    templateId: publicTemplateId,
    checkoutUrl: updated.checkoutUrl
  }).catch((err) => {
    logIgnored(err, "payment link: failed to create public checkout before notifications", {
      subscriptionId: sub.id,
      paymentId: updated.id,
      templateId: publicTemplateId
    });
    return null;
  });
  if (!String(publicCheckout?.url || "").trim()) {
    throw new Error("public_checkout_create_failed");
  }

  const scheduledInfo = await schedulePaymentLinkNotifications({ paymentId: updated.id, forceNow: true }).catch((err) => {
    logIgnored(err, "payment link: failed to schedule notifications", { paymentId: updated.id });
    return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };
  });
  const chatwootError = firstNotificationDeliveryError(scheduledInfo) || null;

  const chatwoot = await getChatwootConfig();
  if (chatwoot.configured) {
    await syncChatwootAttributesForCustomer(sub.customerId).catch((err) => {
      logIgnored(err, "payment link: failed to sync chatwoot attributes", { customerId: sub.customerId });
    });
  }

  if (!updated.checkoutUrl) throw new Error("checkout_url_missing");
  return {
    paymentId: updated.id,
    wompiPaymentLinkId: created.id,
    checkoutUrl: updated.checkoutUrl,
    notificationsScheduled: scheduledInfo?.scheduled ?? 0,
    notificationsSent: scheduledInfo?.sentNow ?? 0,
    notificationsRulesActive: scheduledInfo?.rulesActive ?? false,
    chatwootError
  };
}

export async function createAutoDebitTransactionForSubscription(args: {
  subscriptionId: string;
  amountInCentsOverride?: number;
  forceNewTransaction?: boolean;
  cycleNumberOverride?: number;
  initiatedBy?: string | null;
}): Promise<{ paymentId: string; wompiTransactionId: string }> {
  const sub = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { plan: true, customer: true }
  });
  if (!sub) throw new Error("subscription_not_found");
  const tenantId = sub.tenantId || sub.plan?.tenantId;
  if (!tenantId) throw new Error("tenant_required");
  if (sub.status === SubscriptionStatus.CANCELED) throw new Error("subscription_canceled");
  if (sub.status === SubscriptionStatus.SUSPENDED) throw new Error("subscription_suspended");
  if (sub.status === SubscriptionStatus.EXPIRED) throw new Error("subscription_expired");

  const collectionMode = resolveSubscriptionCollectionMode(sub);
  if (collectionMode !== "AUTO_DEBIT") {
    throw new Error("auto_debit_not_allowed_for_collection_mode");
  }

  // FIX: Validar email PRIMERO (Wompi lo requiere para transacciones)
  if (!sub.customer.email) {
    throw new Error("customer_email_required");
  }

  const paymentSourceId = extractCustomerPaymentSourceId(sub.customer.metadata);
  if (paymentSourceId === null) throw new Error("customer_payment_source_missing");

  const overrideCycle = Number.isFinite(args.cycleNumberOverride)
    ? Math.max(1, Math.trunc(args.cycleNumberOverride as number))
    : null;
  const billingState = await resolveSubscriptionBillingState({ subscriptionId: sub.id }).catch((err) => {
    logIgnored(err, "auto debit: failed to resolve billing state", { subscriptionId: sub.id });
    return null;
  });
  const inferredCycle = billingState?.collectionCycle?.cycleNumber ?? 1;
  const cycle = overrideCycle ?? inferredCycle;
  let reference = `SUB_${sub.id}_${cycle}`;
  const amountInCents = Math.trunc(args.amountInCentsOverride ?? readSubscriptionTotalInCents(sub.metadata, sub.plan.priceInCents, sub.plan.metadata));
  const currency = validateWompiCurrency(sub.plan.currency);

  const subscriptionCycleKey = `${sub.id}:${cycle}`;
  const manualInitiator = String(args.initiatedBy || "").trim();
  const paymentOrigin = manualInitiator ? "MANUAL_USER" : "AUTO_DEBIT";
  const associatedBy = manualInitiator || "system";
  const existingApproved = await prisma.payment.findFirst({
    where: { subscriptionId: sub.id, cycleNumber: cycle, status: PaymentStatus.APPROVED },
    select: { id: true, wompiTransactionId: true }
  });
  if (existingApproved) {
    throw new Error("payment_already_approved");
  }

  if (!args.forceNewTransaction) {
    const existingByCycle = await prisma.payment.findUnique({
      where: { subscriptionCycleKey },
      select: { id: true, status: true, wompiTransactionId: true, reference: true }
    });

    if (existingByCycle?.wompiTransactionId && existingByCycle.status === PaymentStatus.PENDING) {
      // Intentar reconciliar para no quedarnos pegados en un pending viejo.
      await reconcileWompiTransaction({
        wompiTransactionId: existingByCycle.wompiTransactionId,
        tenantId,
        checksumPrefix: "auto-debit-precheck"
      }).catch((err: any) => {
        logIgnored(err, "auto debit: failed reconcile precheck", { subscriptionId: sub.id, paymentId: existingByCycle.id });
      });
      const refreshed = await prisma.payment.findUnique({
        where: { id: existingByCycle.id },
        select: { status: true, wompiTransactionId: true, reference: true }
      });
      if (refreshed?.status && refreshed.status !== PaymentStatus.PENDING) {
        if (refreshed.status === PaymentStatus.APPROVED && refreshed.wompiTransactionId) {
          return { paymentId: existingByCycle.id, wompiTransactionId: refreshed.wompiTransactionId };
        }
        // Si falló, permitimos crear un nuevo intento abajo.
      } else {
        return { paymentId: existingByCycle.id, wompiTransactionId: existingByCycle.wompiTransactionId };
      }
    }
  }

  let payment:
    | { id: string; wompiTransactionId: string | null; status: PaymentStatus; reference: string }
    | any;
  if (args.forceNewTransaction) {
    const attemptCount = await prisma.payment.count({ where: { subscriptionId: sub.id, cycleNumber: cycle } });
    const retrySuffix = `R${Math.max(1, attemptCount + 1)}`;
    reference = `${reference}_${retrySuffix}`;
    payment = await prisma.payment.create({
      data: {
        tenantId,
        customerId: sub.customerId,
        subscriptionId: sub.id,
        amountInCents,
        currency,
        cycleNumber: cycle,
        reference,
        status: PaymentStatus.PENDING,
        subscriptionCycleKey: null,
        origin: paymentOrigin as any,
        associationReason: "SUB_REF",
        associatedBy
      },
      select: { id: true, wompiTransactionId: true, status: true, reference: true }
    });
  } else {
    payment = await prisma.payment.upsert({
      where: { subscriptionCycleKey },
      create: {
        tenantId,
        customerId: sub.customerId,
        subscriptionId: sub.id,
        amountInCents,
        currency,
        cycleNumber: cycle,
        reference,
        status: PaymentStatus.PENDING,
        subscriptionCycleKey,
        origin: paymentOrigin as any,
        associationReason: "SUB_REF",
        associatedBy
      },
      update: {
        tenantId,
        amountInCents,
        currency,
        reference,
        status: PaymentStatus.PENDING,
        failedAt: null
      },
      select: { id: true, wompiTransactionId: true, status: true, reference: true }
    });
  }

  if (payment.wompiTransactionId && !args.forceNewTransaction) {
    return { paymentId: payment.id, wompiTransactionId: payment.wompiTransactionId };
  }

  if (payment.wompiTransactionId && args.forceNewTransaction) {
    const attemptCount = await prisma.paymentAttempt.count({
      where: { paymentId: payment.id }
    });
    const retrySuffix = `R${Math.max(1, attemptCount + 1)}`;
    const nextReference = `${reference}_${retrySuffix}`;
    reference = nextReference;
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        reference: nextReference,
        wompiTransactionId: null,
        providerResponse:
          payment.providerResponse && typeof payment.providerResponse === "object"
            ? {
                ...(payment.providerResponse as Record<string, unknown>),
                retry: {
                  previousReference: payment.reference,
                  previousWompiTransactionId: payment.wompiTransactionId,
                  retriedAt: new Date().toISOString()
                }
              }
            : {
                retry: {
                  previousReference: payment.reference,
                  previousWompiTransactionId: payment.wompiTransactionId,
                  retriedAt: new Date().toISOString()
                }
              }
      }
    });
  }

  const lockKey = `${AUTO_DEBIT_LOCK_PREFIX}:${subscriptionCycleKey}`;
  const locked = await tryAcquirePaymentLinkLock(lockKey);
  if (!locked) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await delay(250);
      const existing = await prisma.payment.findUnique({
        where: { id: payment.id },
        select: { wompiTransactionId: true, status: true }
      });
      if (existing?.wompiTransactionId) {
        return { paymentId: payment.id, wompiTransactionId: existing.wompiTransactionId };
      }
      if (existing?.status === PaymentStatus.APPROVED) {
        throw new Error("payment_already_approved");
      }
    }
    await systemLog(LogLevel.WARN, "subscriptions.auto_debit", "Auto debit already in progress", {
      subscriptionId: sub.id,
      paymentId: payment.id
    }).catch((err: any) => {
      logIgnored(err, "auto debit: failed to write in-progress log", { subscriptionId: sub.id, paymentId: payment.id });
    });
    throw new Error("auto_debit_in_progress");
  }

  let lockReleased = false;
  const releaseLock = async () => {
    if (lockReleased) return;
    lockReleased = true;
    await releasePaymentLinkLock(lockKey).catch((err) => {
      logIgnored(err, "auto debit: failed to release advisory lock", { lockKey });
    });
  };

  const privateKey = await getWompiPrivateKey();
  if (!privateKey) {
    await releaseLock();
    throw new Error("wompi_private_key_not_configured");
  }
  const integritySecret = await getWompiIntegritySecret();
  if (!integritySecret) {
    await releaseLock();
    throw new Error("wompi_integrity_secret_not_configured");
  }
  const publicKey = await getWompiPublicKey();
  if (!publicKey) {
    await releaseLock();
    throw new Error("wompi_public_key_not_configured");
  }

  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey, checkoutLinkBaseUrl });
  let merchant: Awaited<ReturnType<WompiClient["getMerchant"]>>;
  try {
    merchant = await wompi.getMerchant(publicKey);
  } catch (err) {
    await releaseLock();
    throw err;
  }

  const signFor = (ref: string) =>
    buildWompiTransactionSignature({
      reference: ref,
      amountInCents,
      currency,
      integritySecret
    });
  let usedReference = reference;
  let created: Awaited<ReturnType<WompiClient["createTransaction"]>>;
  try {
    const existingAfterLock = await prisma.payment.findUnique({
      where: { id: payment.id },
      select: { wompiTransactionId: true, status: true }
    });
    if (existingAfterLock?.wompiTransactionId) {
      await releaseLock();
      return { paymentId: payment.id, wompiTransactionId: existingAfterLock.wompiTransactionId };
    }
    if (existingAfterLock?.status === PaymentStatus.APPROVED) {
      await releaseLock();
      throw new Error("payment_already_approved");
    }

    const signed = signFor(usedReference);
    usedReference = signed.normalizedReference;
    created = await wompi.createTransaction({
      amount_in_cents: signed.normalizedAmountInCents,
      currency: signed.normalizedCurrency,
      customer_email: sub.customer.email,
      reference: usedReference,
      signature: signed.signature,
      acceptance_token: merchant.acceptanceToken,
      accept_personal_auth: merchant.acceptPersonalAuth,
      payment_source_id: paymentSourceId,
      recurrent: true,
      payment_method: { installments: 1 }
    });
  } catch (err) {
    const errMsg = getErrorMessage(err);
    const duplicateReference =
      /reference/i.test(errMsg) &&
      /(ya ha sido usada|already used|already been used)/i.test(errMsg);

    if (duplicateReference) {
      await systemLog(LogLevel.WARN, "subscriptions.auto_debit", "Reference duplicada en Wompi; bloqueo preventivo para evitar cobro duplicado", {
        subscriptionId: sub.id,
        paymentId: payment.id,
        previousReference: reference,
        nextReference: null
      }).catch((err) => {
        logIgnored(err, "auto debit: failed to write duplicate-reference log", { subscriptionId: sub.id, paymentId: payment.id });
      });
      // Guard-rail anti-duplicado:
      // si Wompi indica referencia usada, no intentamos crear un nuevo cargo con otra referencia.
      // El runner de conciliación se encarga de recuperar el estado real por referencia/transacción.
      throw new Error("wompi_reference_already_used_guard");
    } else {
      await systemLog(LogLevel.ERROR, "subscriptions.auto_debit", "Transaction create failed (signature details)", {
        subscriptionId: sub.id,
        paymentId: payment.id,
        reference: usedReference,
        amountInCents,
        currency,
        signature: signFor(usedReference).signature,
        err: errMsg
      }).catch((logErr) => {
        logIgnored(logErr, "auto debit: failed to write error system log", { subscriptionId: sub.id, paymentId: payment.id });
      });
      await prisma.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          attemptNo: 0,
          status: "TRANSACTION_CREATE_FAILED",
          provider: "wompi",
          errorMessage: getErrorMessage(err)
        }
      });
      await systemLog(LogLevel.ERROR, "subscriptions.auto_debit", "Transaction create failed", {
        subscriptionId: sub.id,
        paymentId: payment.id,
        err: errMsg
      }).catch((logErr) => {
        logIgnored(logErr, "auto debit: failed to write error system log", { subscriptionId: sub.id, paymentId: payment.id });
      });
      throw err;
    }
  } finally {
    await releaseLock();
  }

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      attemptNo: 0,
      status: "TRANSACTION_CREATED",
      provider: "wompi",
      response: created.raw
    }
  });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { reference: usedReference, wompiTransactionId: created.id, providerResponse: created.raw }
  });

  await systemLog(LogLevel.INFO, "subscriptions.auto_debit", "Transaction created", {
    subscriptionId: sub.id,
    paymentId: updated.id,
    wompiTransactionId: created.id
  }).catch((err) => {
    logIgnored(err, "auto debit: failed to write system log", { subscriptionId: sub.id, paymentId: updated.id });
  });

  return { paymentId: updated.id, wompiTransactionId: created.id };
}
