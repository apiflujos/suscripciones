import "server-only";

import { prisma } from "@suscripciones/database";
import { BillingCycleStatus, LogLevel, PaymentOrigin, PaymentStatus, PlanIntervalUnit, Prisma, RetryJobStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { ensurePaymentRetryJob } from "@suscripciones/core/services/retryJobScheduler";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { getAutoDebitConfig } from "@suscripciones/core/services/runtimeConfig";
import { addIntervalUtc, toUtc } from "@suscripciones/core/lib/dates";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { ensureBillingCyclesForSubscription, syncSubscriptionBillingSnapshot } from "@suscripciones/core/services/billingCycles";
import { createPaymentLinkForSubscription } from "@suscripciones/core/services/subscriptionBilling";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { consumeApp } from "@suscripciones/core/services/superAdminApp";
import { logger } from "@suscripciones/core/lib/logger";
import { extractCustomerPaymentSourceId } from "@suscripciones/core/lib/customerMetadata";
import { listPlanIdsForCatalogProducts, resolveOperationalPlanForProduct } from "./productPlanMapping";
import {
  computeDueAtForPeriod,
  computePlanTotalInCents,
  DEFAULT_SUBSCRIPTION_CYCLE_START_DAY,
  DEFAULT_SUBSCRIPTION_PAYMENT_DAY,
  DEFAULT_SUBSCRIPTION_PAYMENT_TIMING,
  normalizeInterval,
  readPlanPricing,
  resolveMonthlyPeriodStart,
  resolvePeriodStartFromAnchor,
  subscriptionIdJsonFilter
} from "./subscriptionShared";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readCatalogItemIdFromPlan(plan: { catalogProductId?: string | null; metadata?: unknown }) {
  const metadata = asRecord(plan.metadata);
  const catalog = asRecord(metadata.catalog);
  return String(plan.catalogProductId || catalog.itemId || "").trim();
}

function readCollectionModeFromMetadata(metadata: unknown) {
  return String(asRecord(metadata).collectionMode || "MANUAL_LINK");
}

function normalizePaymentTiming(value: unknown): "EN_CURSO" | "ANTICIPADO" {
  return String(value || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

export async function createSubscription(args: {
  customerId: string;
  empresaId?: string | null;
  contactoId?: string | null;
  planId?: string;
  productId?: string;
  tenantIds: string[];
  startAt?: string;
  firstPeriodEndAt?: string;
  cycleStartDay?: number | string;
  paymentDay?: number | string;
  paymentTiming?: string;
  createPaymentLink?: boolean;
  allowDuplicate?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const requestedPlanId = String(args.planId || "").trim();
  const effectiveTenantIds = Array.from(new Set((args.tenantIds || []).map((t) => String(t || "").trim()).filter(Boolean)));
  const tenantIdForResolution = effectiveTenantIds[0] || null;

  const directPlan = requestedPlanId
    ? await prisma.subscriptionPlan.findUnique({ where: { id: requestedPlanId }, include: { tenantLinks: true } })
    : null;
  const resolvedPlan =
    directPlan ||
    (await resolveOperationalPlanForProduct({
      productId: args.productId,
      tenantId: tenantIdForResolution
    }));
  const plan = resolvedPlan;
  if (!plan) return { ok: false, status: 404, error: "plan_no_encontrado" as const };

  const customer = await prisma.customer.findUnique({ where: { id: args.customerId } });
  if (!customer) return { ok: false, status: 404, error: "customer_no_encontrado" as const };

  const planTenantIds = Array.from(new Set([plan.tenantId, ...(plan.tenantLinks || []).map((t) => t.tenantId)].filter(Boolean))) as string[];
  if (!effectiveTenantIds.length) return { ok: false, status: 400, error: "tenant_requerido" as const };

  if (planTenantIds.length) {
    const invalid = effectiveTenantIds.find((t) => !planTenantIds.includes(t));
    if (invalid) return { ok: false, status: 409, error: "tenant_no_permitido_para_plan" as const };
  }
  const customerTenantIds = Array.from(
    new Set(
      [
        String(customer.tenantId || ""),
        ...(
          await prisma.customerTenant.findMany({
            where: { customerId: customer.id, tenantId: { in: effectiveTenantIds } },
            select: { tenantId: true }
          })
        ).map((row) => String(row.tenantId || ""))
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
  const invalidCustomerTenant = effectiveTenantIds.find((tenantId) => !customerTenantIds.includes(tenantId));
  if (invalidCustomerTenant) return { ok: false, status: 409, error: "tenant_mismatch" as const };
  if (!args.allowDuplicate) {
    const catalogItemId = readCatalogItemIdFromPlan(plan);
    const activeStatuses = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED, SubscriptionStatus.EXPIRED];
    const duplicateWhere: Prisma.SubscriptionWhereInput = {
      customerId: args.customerId,
      status: { in: activeStatuses }
    };
    if (catalogItemId) {
      duplicateWhere.OR = [
        { productId: catalogItemId },
        { planId: plan.id },
        { plan: { catalogProductId: catalogItemId } }
      ];
    } else {
      duplicateWhere.planId = plan.id;
    }
    const duplicatesCount = await prisma.subscription.count({ where: duplicateWhere });
    if (duplicatesCount > 0) return { ok: false, status: 409, error: "suscripcion_duplicada_requiere_aprobacion" as const };
  }
  const tenantId = effectiveTenantIds[0];

  const collectionMode = readCollectionModeFromMetadata(plan.metadata);
  const paymentSourceId = extractCustomerPaymentSourceId(customer.metadata);
  const hasPaymentSource = paymentSourceId !== null;
  const startAt = args.startAt ? new Date(args.startAt) : new Date();
  const computedEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);
  const periodEnd = args.firstPeriodEndAt ? new Date(args.firstPeriodEndAt) : computedEnd;
  if (Number.isNaN(periodEnd.getTime())) return { ok: false, status: 400, error: "first_period_end_at_invalido" as const };
  if (periodEnd < startAt) return { ok: false, status: 400, error: "first_period_end_anterior_a_start" as const };

  const subscriptionMetaBase = asRecord(args.metadata);
  const autoDebitCfg = await getAutoDebitConfig().catch(() => null);
  const defaultGraceDays = Number(autoDebitCfg?.graceDays || 5);
  const graceDays = Number.isFinite(defaultGraceDays) ? Math.max(1, Math.min(5, Math.trunc(defaultGraceDays))) : 5;
  const cycleStartDay = Math.max(
    1,
    Math.min(
      31,
      Math.trunc(
        Number(
          args.cycleStartDay ??
            startAt.getUTCDate() ??
            DEFAULT_SUBSCRIPTION_CYCLE_START_DAY
        ) || DEFAULT_SUBSCRIPTION_CYCLE_START_DAY
      )
    )
  );
  const paymentDay = Math.max(
    1,
    Math.min(31, Math.trunc(Number(args.paymentDay ?? cycleStartDay) || DEFAULT_SUBSCRIPTION_PAYMENT_DAY))
  );
  const paymentTiming =
    String(args.paymentTiming || DEFAULT_SUBSCRIPTION_PAYMENT_TIMING).toUpperCase() === "ANTICIPADO"
      ? "ANTICIPADO"
      : "EN_CURSO";

  const dueAt = computeDueAtForPeriod({
    periodStartAt: startAt,
    periodEndAt: periodEnd,
    cycleStartDay,
    paymentDay,
    paymentTiming,
    intervalUnit: plan.intervalUnit
  }) || periodEnd;
  const dueWithGraceAt = new Date(dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
  const initialStatus = dueWithGraceAt.getTime() < Date.now() ? SubscriptionStatus.PAST_DUE : SubscriptionStatus.ACTIVE;
  const resolvedProductId = String(args.productId || readCatalogItemIdFromPlan(plan)).trim() || null;

  const subscription = await prisma.subscription.create({
    data: {
      tenantId,
      customerId: args.customerId,
      empresaId: args.empresaId || null,
      contactoId: args.contactoId || null,
      planId: plan.id,
      productId: resolvedProductId,
      status: initialStatus,
      startAt,
      cycleStartDay,
      paymentDay,
      paymentTiming,
      graceDays,
      metadata: {
        ...subscriptionMetaBase,
        pricing:
          subscriptionMetaBase?.pricing && typeof subscriptionMetaBase.pricing === "object"
            ? subscriptionMetaBase.pricing
            : readPlanPricing(plan.metadata),
        collectionMode
      } as Prisma.InputJsonValue
    }
  });

  await ensureBillingCyclesForSubscription({
    id: subscription.id,
    startAt: subscription.startAt,
    anchorCycleNumber: 1,
    anchorPeriodStartAt: startAt,
    anchorPeriodEndAt: periodEnd,
    cycleStartDay: subscription.cycleStartDay,
    paymentDay: subscription.paymentDay,
    paymentTiming: normalizePaymentTiming(subscription.paymentTiming),
    graceDays: subscription.graceDays,
    plan: {
      intervalUnit: plan.intervalUnit,
      intervalCount: plan.intervalCount
    }
  }).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo generando ciclos iniciales de suscripción");
  });

  if (collectionMode === "AUTO_DEBIT" || collectionMode === "AUTO_LINK") {
    await ensurePaymentRetryJob({ subscriptionId: subscription.id, runAt: dueAt, maxAttempts: 1 }).catch((err) => {
      logger.warn({ err, subscriptionId: subscription.id }, "Fallo agendando cobro inicial de suscripción");
    });
  }
  await prisma.subscriptionTenant.createMany({
    data: effectiveTenantIds.map((t) => ({ subscriptionId: subscription.id, tenantId: t })),
    skipDuplicates: true
  });
  await prisma.customerTenant
    .createMany({ data: effectiveTenantIds.map((t) => ({ customerId: customer.id, tenantId: t })), skipDuplicates: true })
    .catch((err) => {
      logger.warn({ err, customerId: customer.id, subscriptionId: subscription.id }, "Fallo asociando customerTenant al crear suscripción");
    });

  await consumeApp("subscriptions_created", {
    amount: 1,
    source: "admin:subscriptions.create",
    meta: { subscriptionId: subscription.id, planId: plan.id }
  });
  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo agendando recordatorios de suscripción");
  });

  const runAt = dueAt <= new Date(Date.now() + 5_000) ? new Date() : dueAt;

  if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
    await ensurePaymentRetryJob({ subscriptionId: subscription.id, runAt, maxAttempts: 1 }).catch((err) => {
      logger.warn({ err, subscriptionId: subscription.id }, "Fallo agendando retry inmediato de suscripción");
    });
    const isDueNow = runAt.getTime() <= Date.now() + 5_000;
    const shouldCreateLinkNow = collectionMode === "AUTO_LINK" ? Boolean(args.createPaymentLink) && isDueNow : false;

    if (!shouldCreateLinkNow) {
      return { ok: true, subscription, scheduled: true };
    }

    try {
      const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
      return {
        ok: true,
        subscription,
        scheduled: true,
        ...link,
        paymentSourceMissing: collectionMode === "AUTO_DEBIT" && !hasPaymentSource
      };
    } catch (err) {
      await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
        subscriptionId: subscription.id,
        err: errorMessage(err)
      }).catch((logErr) => {
        logger.warn({ err: logErr, subscriptionId: subscription.id }, "Fallo escribiendo systemLog por error creando payment link de suscripcion");
      });
      return { ok: true, subscription, scheduled: true, paymentLinkError: "fallo_creando_link_de_pago" };
    }
  }

  if (!args.createPaymentLink) return { ok: true, subscription };

  try {
    const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
    return { ok: true, subscription, ...link };
  } catch (err) {
    await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
      subscriptionId: subscription.id,
      err: errorMessage(err)
    }).catch((logErr) => {
      logger.warn({ err: logErr, subscriptionId: subscription.id }, "Fallo escribiendo systemLog por error creando payment link de suscripcion");
    });
    return { ok: true, subscription, paymentLinkError: "fallo_creando_link_de_pago" };
  }
}

export async function updateSubscriptionTenants(args: {
  subscriptionId: string;
  tenantId?: string | null;
  tenantIds: string[];
  primaryTenantId?: string | null;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "missing_subscription_id" as const };

  const existing = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { tenantLinks: true }
  });
  if (!existing) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      existing.tenantId === args.tenantId || (existing.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
    const invalid = (args.tenantIds || []).find((t) => t !== args.tenantId);
    if (invalid) return { ok: false, status: 403, error: "tenant_forbidden" as const };
    if (args.primaryTenantId && args.primaryTenantId !== args.tenantId) return { ok: false, status: 403, error: "tenant_forbidden" as const };
  }

  const requestedTenantIds: string[] = Array.from(new Set((args.tenantIds || []).map((v) => String(v || "").trim()).filter(Boolean)));
  const primaryTenantId = String(args.primaryTenantId || "").trim() || requestedTenantIds[0] || null;
  if (!requestedTenantIds.length && !primaryTenantId) {
    return { ok: false, status: 400, error: "tenant_required" as const };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.subscription.update({
      where: { id: subscriptionId },
      data: primaryTenantId ? { tenantId: primaryTenantId } : {}
    });
    await tx.subscriptionTenant.deleteMany({ where: { subscriptionId } });
    if (requestedTenantIds.length) {
      await tx.subscriptionTenant.createMany({
        data: requestedTenantIds.map((t) => ({ subscriptionId, tenantId: t })),
        skipDuplicates: true
      });
    }
    return next;
  });

  return { ok: true, subscription: updated };
}

export async function updateSubscriptionBillingSettings(args: {
  subscriptionId: string;
  tenantId?: string | null;
  startAt?: string;
  collectionMode?: string;
  cycleStartDay?: number | string;
  paymentDay?: number | string;
  paymentTiming?: string;
  graceDays?: number | string;
  actor?: string;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false as const, status: 400, error: "invalid_subscription_id" as const };
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: { select: { intervalUnit: true, intervalCount: true } } }
  });
  if (!subscription) return { ok: false as const, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId && String(subscription.tenantId || "") !== String(args.tenantId || "")) {
    return { ok: false as const, status: 404, error: "subscription_not_found" as const };
  }

  const cycleStartDay = Number(args.cycleStartDay ?? subscription.cycleStartDay ?? 1);
  const paymentDay = Number(args.paymentDay ?? subscription.paymentDay ?? 1);
  const autoDebitCfg = await getAutoDebitConfig().catch(() => null);
  const graceDays = Number.isFinite(Number(autoDebitCfg?.graceDays))
    ? Math.max(1, Math.min(30, Math.trunc(Number(autoDebitCfg?.graceDays))))
    : Math.max(1, Math.min(30, Math.trunc(Number(subscription.graceDays || 5))));
  const timingRaw = String(args.paymentTiming ?? subscription.paymentTiming ?? "EN_CURSO").toUpperCase();
  const paymentTiming = timingRaw === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";

  const planUnitRaw = String(subscription.plan?.intervalUnit || "MONTH").toUpperCase();
  const planCountRaw = Number(subscription.plan?.intervalCount || 1);
  const normalized = normalizeInterval(planUnitRaw, planCountRaw);
  const cycleDay = Math.max(1, Math.min(31, Math.trunc(cycleStartDay)));
  const now = new Date();

  const anchor = args.startAt
    ? (() => {
        const d = new Date(args.startAt + "T12:00:00Z");
        return Number.isNaN(d.getTime()) ? (subscription.startAt ? new Date(subscription.startAt) : now) : d;
      })()
    : (subscription.startAt ? new Date(subscription.startAt) : now);

  const baseStart =
    normalized.unit === "MONTH"
      ? resolveMonthlyPeriodStart(toUtc(now), cycleDay)
      : resolvePeriodStartFromAnchor(now, anchor, normalized.unit, normalized.count);

  const normalizedUnit = normalized.unit as PlanIntervalUnit; // cast necesario: normalizeInterval retorna string controlado del dominio
  const effectiveStart =
    paymentTiming === "ANTICIPADO"
      ? addIntervalUtc(baseStart, normalizedUnit, normalized.count)
      : baseStart;

  const effectiveEnd = addIntervalUtc(effectiveStart, normalizedUnit, normalized.count);
  const subscriptionMetadata = asRecord(subscription.metadata);

  const normalizedCollectionMode = args.collectionMode
    ? String(args.collectionMode).trim().toUpperCase() === "AUTO_DEBIT" ? "AUTO_DEBIT" : "MANUAL_LINK"
    : null;

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      ...(args.startAt ? { startAt: anchor } : {}),
      cycleStartDay: Math.max(1, Math.min(31, Math.trunc(cycleStartDay))),
      paymentDay: Math.max(1, Math.min(31, Math.trunc(paymentDay))),
      graceDays: graceDays,
      paymentTiming,
      ...(normalizedCollectionMode ? {
        metadata: {
          ...subscriptionMetadata,
          collectionMode: normalizedCollectionMode
        }
      } : {})
    }
  });

  await systemLog(LogLevel.INFO, "subscriptions.billing_rules", "Reglas de ciclo actualizadas", {
    subscriptionId,
    cycleStartDay: updated.cycleStartDay,
    paymentDay: updated.paymentDay,
    paymentTiming: updated.paymentTiming,
    graceDays: updated.graceDays,
    graceDaysSource: "AUTO_DEBIT_CONFIG",
    ...(normalizedCollectionMode ? { collectionMode: normalizedCollectionMode } : {})
  }, args.actor || "Sistema").catch((err) => {
    logger.warn({ err, subscriptionId }, "Fallo escribiendo systemLog al actualizar reglas de ciclo");
  });

  await ensureBillingCyclesForSubscription({
    id: updated.id,
    startAt: updated.startAt,
    anchorCycleNumber: paymentTiming === "ANTICIPADO" ? 2 : 1,
    anchorPeriodStartAt: effectiveStart,
    anchorPeriodEndAt: effectiveEnd,
    cycleStartDay: updated.cycleStartDay,
    paymentDay: updated.paymentDay,
    paymentTiming: normalizePaymentTiming(updated.paymentTiming),
    graceDays: updated.graceDays,
    plan: {
      intervalUnit: subscription.plan.intervalUnit,
      intervalCount: subscription.plan.intervalCount
    }
  }).catch((err) => {
    logger.warn({ err, subscriptionId }, "Fallo regenerando ciclos tras actualizar reglas de suscripción");
  });

  await syncSubscriptionBillingSnapshot({ subscriptionId, asOf: new Date() }).catch((err) => {
    logger.warn({ err, subscriptionId }, "Fallo sincronizando snapshot tras actualizar reglas");
  });

  return { ok: true as const };
}

export async function changeSubscriptionPlan(args: {
  subscriptionId: string;
  planId?: string;
  productId?: string;
  cutoffAt: string;
  shippingInCents?: number;
  freeShipping?: boolean;
  tenantId?: string | null;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "missing_subscription_id" as const };
  const cutoffAtRaw = String(args.cutoffAt || "").trim();
  const cutoffAt = new Date(cutoffAtRaw);
  if (!cutoffAtRaw || Number.isNaN(cutoffAt.getTime())) return { ok: false, status: 400, error: "invalid_cutoff_date" as const };

  const requestedPlanId = String(args.planId || "").trim();
  const requestedProductId = String(args.productId || "").trim();
  const [subscription, directPlan] = await Promise.all([
    prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true, plan: true } }),
    requestedPlanId
      ? prisma.subscriptionPlan.findUnique({ where: { id: requestedPlanId }, include: { tenantLinks: true } })
      : Promise.resolve(null)
  ]);
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  const plan =
    directPlan ||
    (await resolveOperationalPlanForProduct({
      productId: requestedProductId,
      tenantId: args.tenantId || subscription.tenantId
    }));
  if (!plan) {
    return {
      ok: false,
      status: 404,
      error: requestedProductId ? ("product_not_found" as const) : ("plan_not_found" as const)
    };
  }
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
    const allowedPlan = plan.tenantId === args.tenantId || (plan.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowedPlan) return { ok: false, status: 404, error: "plan_not_found" as const };
  }

  const planMeta = asRecord(plan.metadata);
  const catalog = asRecord(planMeta.catalog);
  const pricing = asRecord(readPlanPricing(planMeta));
  const sourcePlanId = String(plan.id || "");
  const kind = String(catalog?.kind || "").toUpperCase();
  const requiresShipping = kind !== "SERVICE";
  const defaultShippingInCents = Number(pricing?.shippingInCents || 0);
  const requestedShippingInCents = requiresShipping ? (args.freeShipping ? 0 : Number(args.shippingInCents ?? defaultShippingInCents)) : 0;

  if (requiresShipping && !args.freeShipping && requestedShippingInCents <= 0) {
    return { ok: false, status: 400, error: "missing_shipping_amount" as const };
  }

  const totals = computePlanTotalInCents({
    basePriceInCents: Number(pricing?.basePriceInCents || plan.priceInCents || 0),
    variantDeltaInCents: Number(catalog?.variantDeltaInCents || 0),
    shippingInCents: requestedShippingInCents,
    discountType: String(pricing?.discountType || "NONE"),
    discountValueInCents: Number(pricing?.discountValueInCents || 0),
    discountPercent: Number(pricing?.discountPercent || 0),
    taxPercent: Number(pricing?.taxPercent || 0)
  });

  const subscriptionMetaBase = asRecord(subscription.metadata);
  const nextSubscriptionMetadata = {
    ...subscriptionMetaBase,
    collectionMode: readCollectionModeFromMetadata(plan.metadata),
    pricing: {
      ...(asRecord(subscriptionMetaBase.pricing)),
      sourcePlanId,
      basePriceInCents: Number(pricing?.basePriceInCents || plan.priceInCents || 0),
      variantDeltaInCents: Number(catalog?.variantDeltaInCents || 0),
      shippingInCents: requestedShippingInCents,
      subtotalInCents: totals.subtotalInCents,
      taxInCents: totals.taxInCents,
      totalInCents: totals.totalInCents,
      freeShipping: Boolean(args.freeShipping),
      currency: plan.currency,
      updatedAt: new Date().toISOString()
    }
  };

  const now = new Date();
  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      planId: plan.id,
      productId: requestedProductId || String(readCatalogItemIdFromPlan(plan)).trim() || null,
      metadata: nextSubscriptionMetadata as Prisma.InputJsonValue
    }
  });

  await ensureBillingCyclesForSubscription({
    id: updated.id,
    startAt: updated.startAt,
    anchorCycleNumber: 1,
    anchorPeriodStartAt: now,
    anchorPeriodEndAt: cutoffAt,
    cycleStartDay: updated.cycleStartDay,
    paymentDay: updated.paymentDay,
    paymentTiming: normalizePaymentTiming(updated.paymentTiming),
    graceDays: updated.graceDays,
    plan: {
      intervalUnit: plan.intervalUnit,
      intervalCount: plan.intervalCount
    }
  }).catch((err) => {
    logger.warn({ err, subscriptionId }, "Fallo regenerando ciclos al cambiar plan");
  });

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: subscriptionIdJsonFilter(subscriptionId)
    }
  });

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo reprogramando notificaciones al cambiar plan");
  });

  const updatedMode = resolveSubscriptionCollectionMode({ metadata: nextSubscriptionMetadata, plan });
  if (updatedMode === "AUTO_LINK" || updatedMode === "AUTO_DEBIT") {
    await ensurePaymentRetryJob({
      subscriptionId,
      runAt: cutoffAt <= new Date(Date.now() + 5_000) ? new Date() : cutoffAt,
      maxAttempts: 1
    }).catch((err) => {
      logger.warn({ err, subscriptionId, runAt: cutoffAt }, "Fallo reprogramando retry al cambiar plan");
    });
  }

  return { ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true };
}

export async function updateSubscriptionStatus(args: {
  subscriptionId: string;
  tenantId?: string | null;
  action: "suspend" | "cancel" | "resume" | "activate";
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      existing.tenantId === args.tenantId || (existing.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  if (args.action === "suspend") {
    if (existing.status === SubscriptionStatus.CANCELED) return { ok: false, status: 409, error: "subscription_canceled" as const };
    if (existing.status === SubscriptionStatus.EXPIRED) return { ok: false, status: 409, error: "subscription_expired" as const };
    if (existing.status === SubscriptionStatus.SUSPENDED) return { ok: false, status: 409, error: "subscription_already_suspended" as const };
    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.SUSPENDED, suspendedAt: new Date() }
    });
    await systemLog(LogLevel.INFO, "subscriptions.suspend", "Subscription suspended", { subscriptionId }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo escribiendo systemLog al suspender suscripcion");
    });
    return { ok: true, subscription: updated };
  }

  if (args.action === "cancel") {
    if (existing.status === SubscriptionStatus.CANCELED) return { ok: false, status: 409, error: "subscription_already_canceled" as const };
    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date(), suspendedAt: null }
    });
    await systemLog(LogLevel.INFO, "subscriptions.cancel", "Subscription canceled", { subscriptionId }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo escribiendo systemLog al cancelar suscripcion");
    });
    return { ok: true, subscription: updated };
  }

  if (args.action === "resume") {
    if (existing.status !== SubscriptionStatus.SUSPENDED) return { ok: false, status: 409, error: "subscription_not_suspended" as const };
    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.ACTIVE, suspendedAt: null }
    });
    await systemLog(LogLevel.INFO, "subscriptions.resume", "Subscription resumed", { subscriptionId }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo escribiendo systemLog al reanudar suscripcion");
    });
    return { ok: true, subscription: updated };
  }

  if (args.action === "activate") {
    if (existing.status !== SubscriptionStatus.CANCELED && existing.status !== SubscriptionStatus.EXPIRED) {
      return { ok: false, status: 409, error: "subscription_not_reactivatable" as const };
    }
    const subscriptionWithPlan = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true }
    });
    if (!subscriptionWithPlan) return { ok: false, status: 404, error: "subscription_not_found" as const };

    const now = new Date();
    const nextPeriodEndAt = addIntervalUtc(
      now,
      subscriptionWithPlan.plan.intervalUnit,
      Math.max(1, Math.trunc(subscriptionWithPlan.plan.intervalCount || 1))
    );
    const latestPreservedCycle = await prisma.subscriptionBillingCycle.findFirst({
      where: {
        subscriptionId,
        status: BillingCycleStatus.PAID
      },
      orderBy: { cycleNumber: "desc" },
      select: { cycleNumber: true }
    });
    const nextCycleNumber = Math.max(1, Number(latestPreservedCycle?.cycleNumber || 0) + 1);

    await prisma.subscriptionBillingCycle.deleteMany({
      where: {
        subscriptionId,
        status: { not: BillingCycleStatus.PAID }
      }
    });

    await ensureBillingCyclesForSubscription({
      id: subscriptionWithPlan.id,
      startAt: subscriptionWithPlan.startAt,
      anchorCycleNumber: nextCycleNumber,
      anchorPeriodStartAt: now,
      anchorPeriodEndAt: nextPeriodEndAt,
      cycleStartDay: subscriptionWithPlan.cycleStartDay,
      paymentDay: subscriptionWithPlan.paymentDay,
      paymentTiming: normalizePaymentTiming(subscriptionWithPlan.paymentTiming),
      graceDays: subscriptionWithPlan.graceDays,
      plan: {
        intervalUnit: subscriptionWithPlan.plan.intervalUnit,
        intervalCount: subscriptionWithPlan.plan.intervalCount
      }
    });

    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        canceledAt: null,
        suspendedAt: null
      }
    });

    await prisma.retryJob.deleteMany({
      where: {
        type: RetryJobType.PAYMENT_RETRY,
        status: RetryJobStatus.PENDING,
        payload: subscriptionIdJsonFilter(subscriptionId)
      }
    }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo limpiando retries pendientes al reactivar suscripcion");
    });

    const collectionMode = resolveSubscriptionCollectionMode(subscriptionWithPlan);
    if (collectionMode === "AUTO_DEBIT" || collectionMode === "AUTO_LINK") {
      await ensurePaymentRetryJob({
        subscriptionId,
        runAt: now,
        maxAttempts: 1
      }).catch((err) => {
        logger.warn({ err, subscriptionId }, "Fallo reprogramando cobro al reactivar suscripcion");
      });
    }

    await scheduleSubscriptionDueNotifications({ subscriptionId }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo reprogramando notificaciones al reactivar suscripcion");
    });

    await syncSubscriptionBillingSnapshot({ subscriptionId, asOf: now });

    await systemLog(LogLevel.INFO, "subscriptions.activate", "Subscription activated", { subscriptionId }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo escribiendo systemLog al activar suscripcion");
    });
    return { ok: true, subscription: updated };
  }

  return { ok: false, status: 400, error: "unknown_action" as const };
}

export async function deleteSubscription(args: { subscriptionId: string; tenantId?: string | null; force?: boolean; purgePayments?: boolean }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { tenantLinks: true }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  const force = Boolean(args.force);
  if (!force && subscription.status !== SubscriptionStatus.CANCELED) {
    return { ok: false, status: 409, error: "subscription_must_be_canceled" as const };
  }

  const [paymentsCount, paymentLinksCount] = await Promise.all([
    prisma.payment.count({ where: { subscriptionId } }),
    prisma.paymentLink.count({ where: { subscriptionId } })
  ]);
  if (!force && (paymentsCount || paymentLinksCount)) {
    return { ok: false, status: 409, error: "subscription_has_dependencies" as const };
  }

  if (force) {
    const payments = await prisma.payment.findMany({ where: { subscriptionId }, select: { id: true } });
    const paymentIds = payments.map((p) => p.id);

    if (paymentIds.length) {
      await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch((err) => {
        logger.warn({ err, subscriptionId, paymentIds }, "Fallo limpiando payment attempts al borrar suscripcion");
      });
    }
    await prisma.chatwootMessage.deleteMany({ where: { subscriptionId } }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo limpiando mensajes Chatwoot al borrar suscripcion");
    });
    await prisma.paymentLink.deleteMany({ where: { subscriptionId } }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo limpiando payment links al borrar suscripcion");
    });
    if (args.purgePayments) {
      await prisma.payment.deleteMany({ where: { subscriptionId } }).catch((err) => {
        logger.warn({ err, subscriptionId }, "Fallo limpiando pagos al borrar suscripcion");
      });
    }
    await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId } }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo limpiando tenants vinculados al borrar suscripcion");
    });
  }

  await prisma.subscription.delete({ where: { id: subscriptionId } });
  return { ok: true };
}

export async function mergeDuplicateSubscriptions(args: {
  customerId: string;
  productId?: string;
  planId?: string;
  keepSubscriptionId?: string;
  tenantId?: string | null;
}) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "missing_customer_id" as const };

  const where: Prisma.SubscriptionWhereInput = { customerId };
  const tenantId = String(args.tenantId || "").trim();
  if (tenantId) where.tenantId = tenantId;

  const requestedProductId = String(args.productId || "").trim();
  const requestedPlanId = String(args.planId || "").trim();
  if (requestedProductId) {
    const planIds = Array.from(
      new Set((await listPlanIdsForCatalogProducts({ productIds: [requestedProductId], tenantId, includeCatalogItems: false })).get(requestedProductId) || [])
    ).filter(Boolean);
    if (requestedPlanId && !planIds.includes(requestedPlanId)) planIds.push(requestedPlanId);
    if (!planIds.length) return { ok: false, status: 404, error: "no_duplicates_found" as const };
    where.planId = { in: planIds };
  } else if (requestedPlanId) {
    where.planId = requestedPlanId;
  }

  const duplicates = await prisma.subscription.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
  if (duplicates.length <= 1) return { ok: false, status: 404, error: "no_duplicates_found" as const };

  let keepId = String(args.keepSubscriptionId || "").trim();
  if (keepId && !duplicates.some((s) => s.id === keepId)) {
    keepId = "";
  }
  if (!keepId) keepId = duplicates[0].id;

  const toMerge = duplicates.filter((s) => s.id !== keepId);
  for (const sub of toMerge) {
    const paymentsCount = await prisma.payment.count({ where: { subscriptionId: sub.id } });
    const linksCount = await prisma.paymentLink.count({ where: { subscriptionId: sub.id } });
    if (!paymentsCount && !linksCount) {
      await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: sub.id } }).catch((err) => {
        logger.warn({ err, subscriptionId: sub.id, keepSubscriptionId: keepId }, "Fallo limpiando tenants al fusionar suscripciones duplicadas");
      });
      await prisma.subscription.delete({ where: { id: sub.id } }).catch((err) => {
        logger.warn({ err, subscriptionId: sub.id, keepSubscriptionId: keepId }, "Fallo borrando suscripcion duplicada vacia");
      });
    } else {
      const meta = asRecord(sub.metadata);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.CANCELED,
          canceledAt: sub.canceledAt || new Date(),
          metadata: { ...meta, mergedInto: keepId } as Prisma.InputJsonValue
        }
      });
    }
  }

  return { ok: true, keepSubscriptionId: keepId, mergedCount: toMerge.length };
}
