import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { addIntervalUtc } from "../lib/dates";
import { LogLevel, PaymentStatus, RetryJobStatus, RetryJobType, SubscriptionStatus, GamificationEntityType } from "@prisma/client";
import { systemLog } from "../services/systemLog";
import { createAutoDebitTransactionForSubscription, createPaymentLinkForSubscription, readSubscriptionTotalInCents } from "../services/subscriptionBilling";
import { getAutoDebitConfig } from "../services/runtimeConfig";
import { scheduleSubscriptionDueNotifications } from "../services/notificationsScheduler";
import { consumeApp } from "../services/superAdminApp";
import { getEffectiveTenantId, getEffectiveTenantIds, readTenantIdsFromReq } from "../services/tenantContext";
import { resolveSubscriptionCollectionMode } from "../services/subscriptionMode";
import { ensurePaymentRetryJob } from "../services/retryJobScheduler";
import { validateWompiCurrency } from "../lib/wompiSignature";

const createSubscriptionSchema = z.object({
  customerId: z.string().uuid(),
  planId: z.string().uuid(),
  startAt: z.string().datetime().optional(),
  firstPeriodEndAt: z.string().datetime().optional(),
  createPaymentLink: z.boolean().optional().default(false),
  allowDuplicate: z.boolean().optional().default(false),
  metadata: z.record(z.any()).optional()
});

const mergeDuplicateSubscriptionsSchema = z.object({
  customerId: z.string().uuid(),
  planId: z.string().uuid().optional(),
  keepSubscriptionId: z.string().uuid().optional()
});

export const subscriptionsRouter = express.Router();

async function recordManualChargeFailure(args: {
  subscription: any;
  amountInCentsOverride?: number;
  errorCode: string;
  details?: unknown;
}) {
  const subscription = args.subscription;
  const tenantId = subscription?.tenantId || subscription?.plan?.tenantId;
  if (!subscription?.id || !subscription?.customerId || !tenantId) return null;

  const cycle = Number(subscription.currentCycle || 1);
  const reference = `SUB_${subscription.id}_${cycle}`;
  const subscriptionCycleKey = `${subscription.id}:${cycle}`;
  const amountInCents = Math.trunc(args.amountInCentsOverride ?? readSubscriptionTotalInCents(subscription.metadata, subscription.plan?.priceInCents ?? 0));
  const currency = validateWompiCurrency(subscription.plan?.currency);
  const existing = await prisma.payment.findUnique({
    where: { subscriptionCycleKey },
    select: { id: true, status: true }
  });

  if (existing?.status === PaymentStatus.APPROVED) return existing.id;

  const payment = await prisma.payment.upsert({
    where: { subscriptionCycleKey },
    create: {
      tenantId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      amountInCents,
      currency,
      cycleNumber: cycle,
      reference,
      status: PaymentStatus.ERROR,
      failedAt: new Date(),
      subscriptionCycleKey
    },
    update: {
      tenantId,
      amountInCents,
      currency,
      reference,
      status: PaymentStatus.ERROR,
      failedAt: new Date()
    }
  });

  const lastAttempt = await prisma.paymentAttempt.findFirst({
    where: { paymentId: payment.id },
    orderBy: [{ attemptNo: "desc" }, { createdAt: "desc" }],
    select: { attemptNo: true }
  });

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      attemptNo: Number(lastAttempt?.attemptNo || 0) + 1,
      status: "MANUAL_CHARGE_FAILED",
      errorCode: args.errorCode,
      errorMessage: args.errorCode,
      provider: "apiflujos",
      response: args.details ? (args.details as any) : undefined
    }
  });

  return payment.id;
}

subscriptionsRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const tenantId = await getEffectiveTenantId(req);
  const takeRaw = Number(req?.query?.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const skipRaw = Number(req?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(req?.query?.q ?? "").trim();
  const customerId = String(req?.query?.customerId ?? "").trim();
  const estado = String(req?.query?.estado ?? "").trim();
  const collectionMode = String(req?.query?.collectionMode ?? "").trim();
  const idsParam = req?.query?.ids;
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (typeof idsParam !== "undefined" && (idsEmpty || ids.length === 0)) {
    return res.json({ items: [], total: 0 });
  }

  const where: any = {};
  if (tenantId) {
    const tenantFilter = { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] };
    where.AND = Array.isArray(where.AND) ? [...where.AND, tenantFilter] : [tenantFilter];
  }
  if (estado === "mora") where.status = SubscriptionStatus.PAST_DUE;
  else if (estado === "si") where.status = SubscriptionStatus.ACTIVE;
  else if (estado === "no") where.status = { notIn: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] };

  if (customerId) {
    where.customerId = customerId;
  }

  if (collectionMode) {
    where.plan = { metadata: { path: ["collectionMode"], equals: collectionMode } } as any;
  }

  if (q) {
    where.customer = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { metadata: { path: ["identificacion"], string_contains: q } } as any,
        { metadata: { path: ["identificacionNumero"], string_contains: q } } as any,
        { metadata: { path: ["documentNumber"], string_contains: q } } as any,
        { metadata: { path: ["document"], string_contains: q } } as any
      ]
    };
  }

  if (ids.length) {
    where.AND = Array.isArray(where.AND) ? [...where.AND, { id: { in: ids } }] : [{ id: { in: ids } }];
  }

  const items = await prisma.subscription.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: { customer: true, plan: { include: { tenantLinks: true } }, tenantLinks: true }
  });
  const total = await prisma.subscription.count({ where });
  const subscriptionIds = items.map((s: any) => s.id);
  const approvedPayments = await prisma.payment.findMany({
    where: { subscriptionId: { in: subscriptionIds }, status: PaymentStatus.APPROVED, paidAt: { not: null } },
    orderBy: { paidAt: "desc" },
    select: { subscriptionId: true, paidAt: true, amountInCents: true, currency: true }
  });

  const lastPaymentBySub = new Map<string, { paidAt: Date; amountInCents: number; currency: string }>();
  for (const p of approvedPayments) {
    if (!p.subscriptionId || !p.paidAt) continue;
    if (!lastPaymentBySub.has(p.subscriptionId)) lastPaymentBySub.set(p.subscriptionId, { paidAt: p.paidAt, amountInCents: p.amountInCents, currency: p.currency });
  }

  const latestLinks = await prisma.paymentLink.findMany({
    where: { subscriptionId: { in: subscriptionIds } },
    orderBy: { sentAt: "desc" },
    select: { subscriptionId: true, sentAt: true, paidAt: true, status: true, checkoutUrl: true }
  });
  const lastLinkBySub = new Map<string, { sentAt: Date | null; paidAt: Date | null; status: string; checkoutUrl?: string | null }>();
  for (const l of latestLinks) {
    if (!l.subscriptionId) continue;
    if (!lastLinkBySub.has(l.subscriptionId)) {
      lastLinkBySub.set(l.subscriptionId, { sentAt: l.sentAt || null, paidAt: l.paidAt || null, status: l.status || "SENT", checkoutUrl: l.checkoutUrl || null });
    }
  }

  res.json({
    items: items.map((s: any) => ({
      ...s,
      tenantIds: Array.from(
        new Set([s.tenantId, ...(s.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))
      ) as string[],
      lastPayment: lastPaymentBySub.get(s.id) ?? null,
      lastPaymentLink: lastLinkBySub.get(s.id) ?? null
    })),
    total
  });
});

subscriptionsRouter.post("/", async (req, res) => {
  const parsed = createSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error('[Subscriptions/Create] Validación fallida', {
      error: parsed.error.flatten(),
      body: req.body
    });
    return res.status(400).json({ error: "cuerpo_invalido", detalles: parsed.error.flatten() });
  }

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: parsed.data.planId }, include: { tenantLinks: true } });
  if (!plan) {
    console.warn('[Subscriptions/Create] Plan no encontrado', { planId: parsed.data.planId });
    return res.status(404).json({ error: "plan_no_encontrado", mensaje: `El plan ${parsed.data.planId} no existe` });
  }

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) {
    console.warn('[Subscriptions/Create] Customer no encontrado', { customerId: parsed.data.customerId });
    return res.status(404).json({ error: "customer_no_encontrado", mensaje: `El customer ${parsed.data.customerId} no existe` });
  }
  const planTenantIds = Array.from(new Set([plan.tenantId, ...(plan.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))) as string[];
  const requestedTenantIds = readTenantIdsFromReq(req);
  const fallbackTenantIds = requestedTenantIds.length ? requestedTenantIds : planTenantIds;
  const effectiveTenantIds = fallbackTenantIds.length ? fallbackTenantIds : (await getEffectiveTenantIds(req));
  if (!effectiveTenantIds.length) {
    console.error('[Subscriptions/Create] Tenant requerido pero no proporcionado');
    return res.status(400).json({ error: "tenant_requerido", mensaje: "Debe pertenecer al menos a un tenant" });
  }

  if (planTenantIds.length) {
    const invalid = effectiveTenantIds.find((t) => !planTenantIds.includes(t));
    if (invalid) {
      console.error('[Subscriptions/Create] Tenant no permitido para este plan', {
        tenantId: invalid,
        planId: plan.id,
        allowedTenantIds: planTenantIds
      });
      return res.status(409).json({ error: "tenant_no_permitido_para_plan", mensaje: "El tenant no está permitido para este plan" });
    }
  }
  if (customer.tenantId && !effectiveTenantIds.includes(customer.tenantId)) {
    console.error('[Subscriptions/Create] Mismatch de tenant', {
      customerId: customer.id,
      customerTenantId: customer.tenantId,
      effectiveTenantIds
    });
    return res.status(409).json({ error: "tenant_mismatch", mensaje: "El customer no pertenece al tenant especificado" });
  }
  if (!customer.tenantId) {
    const linked = await prisma.customerTenant.findFirst({
      where: { customerId: customer.id, tenantId: { in: effectiveTenantIds } }
    });
    if (!linked) {
      console.error('[Subscriptions/Create] Customer sin link a tenant', {
        customerId: customer.id,
        tenantIds: effectiveTenantIds
      });
      return res.status(409).json({ error: "tenant_mismatch", mensaje: "El customer no está vinculado al tenant especificado" });
    }
  }
  if (!parsed.data.allowDuplicate) {
    const catalogItemId = String((plan.metadata as any)?.catalog?.itemId || "").trim();
    const activeStatuses = [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.SUSPENDED,
      SubscriptionStatus.EXPIRED
    ];
    const duplicateWhere: any = {
      customerId: parsed.data.customerId,
      status: { in: activeStatuses }
    };
    if (catalogItemId) {
      duplicateWhere.OR = [
        { planId: parsed.data.planId },
        { plan: { metadata: { path: ["catalog", "itemId"], equals: catalogItemId } as any } }
      ];
    } else {
      duplicateWhere.planId = parsed.data.planId;
    }
    const duplicatesCount = await prisma.subscription.count({ where: duplicateWhere });
    if (duplicatesCount > 0) {
      console.warn('[Subscriptions/Create] Suscripción duplicada detectada', {
        customerId: parsed.data.customerId,
        planId: parsed.data.planId,
        duplicatesCount,
        catalogItemId
      });
      return res.status(409).json({
        error: "suscripcion_duplicada_requiere_aprobacion",
        mensaje: "Ya existe una suscripción activa para este customer y plan",
        detalles: {
          duplicatesCount,
          customerId: parsed.data.customerId,
          planId: parsed.data.planId,
          catalogItemId: catalogItemId || null
        }
      });
    }
  }
  const tenantId = effectiveTenantIds[0];

  const collectionMode = String((plan.metadata as any)?.collectionMode || "MANUAL_LINK");
  const paymentSourceId = (() => {
    const meta = (customer.metadata as any) ?? {};
    const candidates = [
      meta?.wompi?.paymentSourceId,
      meta?.wompi?.payment_source_id,
      meta?.paymentSourceId,
      meta?.payment_source_id
    ];
    for (const v of candidates) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    }
    return null;
  })();
  const hasPaymentSource = Number.isFinite(paymentSourceId as any);
  const startAt = parsed.data.startAt ? new Date(parsed.data.startAt) : new Date();
  const computedEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);
  const periodEnd = parsed.data.firstPeriodEndAt ? new Date(parsed.data.firstPeriodEndAt) : computedEnd;
  if (Number.isNaN(periodEnd.getTime())) {
    console.error('[Subscriptions/Create] firstPeriodEndAt inválido', { firstPeriodEndAt: parsed.data.firstPeriodEndAt });
    return res.status(400).json({ error: "first_period_end_at_invalido", mensaje: "La fecha firstPeriodEndAt no es válida" });
  }
  if (periodEnd < startAt) {
    console.error('[Subscriptions/Create] firstPeriodEndAt anterior a startAt', { startAt, periodEnd });
    return res.status(400).json({ error: "first_period_end_anterior_a_start", mensaje: "La fecha de fin del período debe ser posterior a la fecha de inicio" });
  }

  const subscriptionMetaBase =
    parsed.data.metadata && typeof parsed.data.metadata === "object" ? (parsed.data.metadata as any) : {};
  
  try {
    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        customerId: parsed.data.customerId,
        planId: plan.id,
        status: SubscriptionStatus.PAST_DUE,
        startAt,
        currentPeriodStartAt: startAt,
        currentPeriodEndAt: periodEnd,
        currentCycle: 1,
        metadata: {
          ...subscriptionMetaBase,
          collectionMode
        } as any
      }
    });
    await prisma.subscriptionTenant.createMany({
      data: effectiveTenantIds.map((t) => ({ subscriptionId: subscription.id, tenantId: t })),
      skipDuplicates: true
    });
    await prisma.customerTenant
      .createMany({ data: effectiveTenantIds.map((t) => ({ customerId: customer.id, tenantId: t })), skipDuplicates: true })
      .catch(() => {});

    await consumeApp("subscriptions_created", { amount: 1, source: "api:subscriptions.create", meta: { subscriptionId: subscription.id, planId: plan.id } });
    await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch((err) => {
      console.error('[Subscriptions/Create] Fallo programando notificaciones', {
        subscriptionId: subscription.id,
        error: err?.message
      });
    });

    const runAt = periodEnd <= new Date(Date.now() + 5_000) ? new Date() : periodEnd;

    // AUTO_* modes: enqueue a single attempt at the cutoff date (no retries).
    if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
      await ensurePaymentRetryJob({ subscriptionId: subscription.id, runAt, maxAttempts: 1 }).catch((err) => {
        console.error('[Subscriptions/Create] Fallo encolando retry job', {
          subscriptionId: subscription.id,
          error: err?.message
        });
      });
      // If requested, generate a link right away (useful for first charge or missing token).
      const isDueNow = runAt.getTime() <= Date.now() + 5_000;
      // AUTO_DEBIT must never auto-create payment links on subscription creation.
      // Tokenization link is a separate explicit action from admin UI.
      const shouldCreateLinkNow = collectionMode === "AUTO_LINK" ? parsed.data.createPaymentLink && isDueNow : false;

      if (!shouldCreateLinkNow) {
        console.log('[Subscriptions/Create] Suscripción creada exitosamente', {
          subscriptionId: subscription.id,
          scheduled: true,
          collectionMode
        });
        return res.status(201).json({ subscription, scheduled: true });
      }

      try {
        const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
        console.log('[Subscriptions/Create] Suscripción con link de pago creado', {
          subscriptionId: subscription.id,
          paymentLinkId: link.wompiPaymentLinkId
        });
        return res.status(201).json({ subscription, scheduled: true, ...link, paymentSourceMissing: collectionMode === "AUTO_DEBIT" && !hasPaymentSource });
      } catch (err: any) {
        console.error('[Subscriptions/Create] Fallo creando link de pago', {
          subscriptionId: subscription.id,
          error: err?.message
        });
        await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
          subscriptionId: subscription.id,
          err: err?.message ? String(err.message) : "unknown error"
        }).catch(() => {});
        return res.status(201).json({ subscription, scheduled: true, paymentLinkError: "fallo_creando_link_de_pago" });
      }
    }

    if (!parsed.data.createPaymentLink) {
      console.log('[Subscriptions/Create] Suscripción creada exitosamente', {
        subscriptionId: subscription.id
      });
      return res.status(201).json({ subscription });
    }

    try {
      const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
      console.log('[Subscriptions/Create] Suscripción con link de pago creado', {
        subscriptionId: subscription.id,
        paymentLinkId: link.wompiPaymentLinkId
      });
      return res.status(201).json({ subscription, ...link });
    } catch (err: any) {
      console.error('[Subscriptions/Create] Fallo creando link de pago', {
        subscriptionId: subscription.id,
        error: err?.message
      });
      await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
        subscriptionId: subscription.id,
        err: err?.message ? String(err.message) : "unknown error"
      }).catch(() => {});
      return res.status(201).json({ subscription, paymentLinkError: "fallo_creando_link_de_pago" });
    }
  } catch (err: any) {
    console.error('[Subscriptions/Create] Error creando suscripción', {
      customerId: parsed.data.customerId,
      planId: parsed.data.planId,
      error: err?.message || String(err),
      stack: err?.stack
    });
    throw err;
  }
});

const createPaymentLinkSchema = z.object({
  // Optional override in case you want to bill a different amount
  amountInCents: z.number().int().positive().optional()
});

const chargeNowSchema = z.object({
  amountInCents: z.number().int().positive().optional()
});

const scheduleCutoffSchema = z.object({
  cutoffAt: z.string().min(1)
});

const changePlanSchema = z.object({
  planId: z.string().uuid(),
  cutoffAt: z.string().min(1),
  shippingInCents: z.number().int().nonnegative().optional(),
  freeShipping: z.boolean().optional().default(false)
});

const updateSubscriptionTenantsSchema = z.object({
  tenantIds: z.array(z.string().uuid()).optional().default([]),
  primaryTenantId: z.string().uuid().optional().or(z.literal(""))
});

function computePlanTotalInCents(args: {
  basePriceInCents: number;
  variantDeltaInCents: number;
  shippingInCents: number;
  discountType?: string | null;
  discountValueInCents?: number | null;
  discountPercent?: number | null;
  taxPercent?: number | null;
}) {
  const base = Number(args.basePriceInCents || 0);
  const delta = Number(args.variantDeltaInCents || 0);
  const shipping = Number(args.shippingInCents || 0);
  const discountType = String(args.discountType || "NONE");
  const discountValue = Number(args.discountValueInCents || 0);
  const discountPercent = Number(args.discountPercent || 0);
  const taxPercent = Number(args.taxPercent || 0);
  let subtotal = base + delta + shipping;
  if (discountType === "FIXED") subtotal -= discountValue;
  else if (discountType === "PERCENT") subtotal -= Math.round((subtotal * discountPercent) / 100);
  if (subtotal < 0) subtotal = 0;
  const taxInCents = Math.round((subtotal * taxPercent) / 100);
  return { subtotalInCents: subtotal, taxInCents, totalInCents: subtotal + taxInCents };
}

function readPlanPricing(meta: any) {
  if (!meta || typeof meta !== "object") return {};
  const root = meta?.pricing;
  const legacy = meta?.catalog?.pricing;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

subscriptionsRouter.post("/:id/payment-link", async (req, res) => {
  const subscriptionId = req.params.id;

  const parsed = createPaymentLinkSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
    if (!existing) return res.status(404).json({ error: "subscription_not_found" });
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }
  try {
    const link = await createPaymentLinkForSubscription({
      subscriptionId,
      amountInCentsOverride: parsed.data.amountInCents
    });
    res.status(201).json(link);
  } catch (err: any) {
    await systemLog(LogLevel.ERROR, "subscriptions.payment_link", "Payment link create failed", {
      subscriptionId,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    res.status(502).json({ error: "wompi_payment_link_failed" });
  }
});

subscriptionsRouter.post("/:id/charge-now", async (req, res) => {
  const subscriptionId = req.params.id;
  const parsed = chargeNowSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const tenantId = await getEffectiveTenantId(req);
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, customer: true, tenantLinks: true }
  });
  if (!subscription) return res.status(404).json({ error: "subscription_not_found" });
  if (tenantId) {
    const allowed = subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode !== "AUTO_DEBIT") {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: parsed.data.amountInCents,
      errorCode: "manual_charge_not_allowed",
      details: { collectionMode }
    }).catch(() => null);
    return res.status(409).json({ error: "manual_charge_not_allowed", details: { collectionMode }, ...(paymentId ? { paymentId } : {}) });
  }
  const autoDebitCfg = await getAutoDebitConfig();
  if (!autoDebitCfg.allowManualCharge) {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: parsed.data.amountInCents,
      errorCode: "manual_charge_disabled_by_settings"
    }).catch(() => null);
    return res.status(409).json({ error: "manual_charge_disabled_by_settings", ...(paymentId ? { paymentId } : {}) });
  }

  const now = new Date();
  const latestApproved = await prisma.payment.findFirst({
    where: { subscriptionId, status: PaymentStatus.APPROVED },
    orderBy: [{ paidAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
    select: { paidAt: true, updatedAt: true, createdAt: true }
  });
  const lastApprovedAt = latestApproved?.paidAt || latestApproved?.updatedAt || latestApproved?.createdAt || null;
  const dueByLastPayment = lastApprovedAt
    ? addIntervalUtc(lastApprovedAt, subscription.plan.intervalUnit, subscription.plan.intervalCount)
    : null;
  const dueByCutoff = subscription.currentPeriodEndAt ? new Date(subscription.currentPeriodEndAt) : null;
  // Regla operativa: la fecha de corte manda.
  // Si existe currentPeriodEndAt, usamos esa como fecha de próximo cobro.
  // Solo si falta currentPeriodEndAt, usamos el cálculo por último pago.
  const dueAt = dueByCutoff || dueByLastPayment;
  const isPastDue = subscription.status === SubscriptionStatus.PAST_DUE;
  if (!isPastDue && dueAt && now.getTime() + 5_000 < dueAt.getTime()) {
    const details = {
      dueAt: dueAt.toISOString(),
      currentPeriodEndAt: dueByCutoff ? dueByCutoff.toISOString() : null,
      expectedByLastPayment: dueByLastPayment ? dueByLastPayment.toISOString() : null
    };
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: parsed.data.amountInCents,
      errorCode: "charge_not_due_yet",
      details
    }).catch(() => null);
    return res.status(409).json({
      error: "charge_not_due_yet",
      details,
      ...(paymentId ? { paymentId } : {})
    });
  }

  const recentPending = await prisma.payment.findFirst({
    where: {
      subscriptionId,
      status: PaymentStatus.PENDING,
      wompiTransactionId: { not: null },
      createdAt: { gte: new Date(now.getTime() - 36 * 60 * 60 * 1000) }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, wompiTransactionId: true, createdAt: true }
  });
  if (recentPending) {
    const details = {
      paymentId: recentPending.id,
      wompiTransactionId: recentPending.wompiTransactionId,
      createdAt: recentPending.createdAt
    };
    const failedPaymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: parsed.data.amountInCents,
      errorCode: "pending_charge_exists",
      details
    }).catch(() => null);
    return res.status(409).json({
      error: "pending_charge_exists",
      details,
      paymentId: failedPaymentId || recentPending.id
    });
  }

  const meta = (subscription.customer?.metadata as any) ?? {};
  const paymentSource =
    meta?.wompi?.paymentSourceId ||
    meta?.wompi?.payment_source_id ||
    meta?.paymentSourceId ||
    meta?.payment_source_id;
  if (!paymentSource) {
    const details = { availableKeys: Object.keys(meta || {}), wompiKeys: Object.keys(meta?.wompi || {}) };
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: parsed.data.amountInCents,
      errorCode: "customer_payment_source_missing",
      details
    }).catch(() => null);
    return res.status(409).json({ error: "customer_payment_source_missing", details, ...(paymentId ? { paymentId } : {}) });
  }
  if (!subscription.customer?.email) {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: parsed.data.amountInCents,
      errorCode: "customer_email_required"
    }).catch(() => null);
    return res.status(409).json({ error: "customer_email_required", ...(paymentId ? { paymentId } : {}) });
  }

  const manualChargeAt = new Date().toISOString();
  const nextMeta = {
    ...(subscription.metadata && typeof subscription.metadata === "object" ? subscription.metadata : {}),
    manualCharge: {
      at: manualChargeAt,
      cycle: subscription.currentCycle ?? 1
    }
  };
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { metadata: nextMeta as any }
  });

  try {
    const result = await createAutoDebitTransactionForSubscription({
      subscriptionId,
      amountInCentsOverride: parsed.data.amountInCents
    });
    res.status(201).json({ ok: true, ...result, manualChargeAt });
  } catch (err: any) {
    const paymentId =
      (
        await prisma.payment.findUnique({
          where: { subscriptionCycleKey: `${subscription.id}:${Number(subscription.currentCycle || 1)}` },
          select: { id: true }
        }).catch(() => null)
      )?.id || null;
    await systemLog(LogLevel.ERROR, "subscriptions.charge_now", "Manual charge failed", {
      subscriptionId,
      paymentId,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    res.status(502).json({ error: err?.message || "charge_now_failed", ...(paymentId ? { paymentId } : {}) });
  }
});

subscriptionsRouter.post("/:id/schedule-cutoff", async (req, res) => {
  const subscriptionId = req.params.id;
  const parsed = scheduleCutoffSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const cutoffAtRaw = String(parsed.data.cutoffAt || "").trim();
  const cutoffAt = new Date(cutoffAtRaw);
  if (!cutoffAtRaw || Number.isNaN(cutoffAt.getTime())) return res.status(400).json({ error: "invalid_cutoff_date" });

  const tenantId = await getEffectiveTenantId(req);
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, tenantLinks: true }
  });
  if (!subscription) return res.status(404).json({ error: "subscription_not_found" });
  if (tenantId) {
    const allowed = subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode !== "AUTO_DEBIT" && collectionMode !== "AUTO_LINK") {
    return res.status(409).json({ error: "schedule_cutoff_not_allowed" });
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { currentPeriodEndAt: cutoffAt }
  });

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: { path: ["subscriptionId"], equals: subscriptionId } as any
    } as any
  });

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});

  await ensurePaymentRetryJob({
    subscriptionId,
    runAt: cutoffAt <= new Date(Date.now() + 5_000) ? new Date() : cutoffAt,
    maxAttempts: 1
  }).catch(() => {});

  res.status(200).json({ ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true });
});

subscriptionsRouter.post("/:id/change-plan", async (req, res) => {
  const subscriptionId = req.params.id;
  const parsed = changePlanSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const cutoffAtRaw = String(parsed.data.cutoffAt || "").trim();
  const cutoffAt = new Date(cutoffAtRaw);
  if (!cutoffAtRaw || Number.isNaN(cutoffAt.getTime())) return res.status(400).json({ error: "invalid_cutoff_date" });

  const tenantId = await getEffectiveTenantId(req);
  const [subscription, plan] = await Promise.all([
    prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true, plan: true } }),
    prisma.subscriptionPlan.findUnique({ where: { id: parsed.data.planId }, include: { tenantLinks: true } })
  ]);
  if (!subscription) return res.status(404).json({ error: "subscription_not_found" });
  if (!plan) return res.status(404).json({ error: "plan_not_found" });
  if (tenantId) {
    const allowed = subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
    const allowedPlan = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowedPlan) return res.status(404).json({ error: "plan_not_found" });
  }

  const planMeta = (plan.metadata as any) ?? {};
  const sourcePlanId = String(plan.id || "");
  const catalog = planMeta?.catalog ?? {};
  const pricing = readPlanPricing(planMeta);
  const kind = String(catalog?.kind || "").toUpperCase();
  // Compatibilidad: si falta kind en datos antiguos, se asume producto para permitir ajustar flete.
  const requiresShipping = kind !== "SERVICE";
  const defaultShippingInCents = Number(pricing?.shippingInCents || 0);
  const requestedShippingInCents = requiresShipping
    ? (parsed.data.freeShipping ? 0 : Number(parsed.data.shippingInCents ?? defaultShippingInCents))
    : 0;

  if (requiresShipping && !parsed.data.freeShipping && requestedShippingInCents <= 0) {
    return res.status(400).json({ error: "missing_shipping_amount" });
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

  const subscriptionMetaBase =
    subscription.metadata && typeof subscription.metadata === "object" ? (subscription.metadata as any) : {};
  const nextSubscriptionMetadata = {
    ...subscriptionMetaBase,
    collectionMode: String((plan.metadata as any)?.collectionMode || "MANUAL_LINK"),
    pricing: {
      ...(subscriptionMetaBase?.pricing && typeof subscriptionMetaBase.pricing === "object"
        ? subscriptionMetaBase.pricing
        : {}),
      sourcePlanId,
      basePriceInCents: Number(pricing?.basePriceInCents || plan.priceInCents || 0),
      variantDeltaInCents: Number(catalog?.variantDeltaInCents || 0),
      shippingInCents: requestedShippingInCents,
      subtotalInCents: totals.subtotalInCents,
      taxInCents: totals.taxInCents,
      totalInCents: totals.totalInCents,
      freeShipping: Boolean(parsed.data.freeShipping),
      currency: plan.currency,
      updatedAt: new Date().toISOString()
    }
  };

  const now = new Date();
  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      planId: plan.id,
      metadata: nextSubscriptionMetadata as any,
      currentCycle: 1,
      currentPeriodStartAt: now,
      currentPeriodEndAt: cutoffAt
    }
  });

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: { path: ["subscriptionId"], equals: subscriptionId } as any
    } as any
  });

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});

  const updatedMode = resolveSubscriptionCollectionMode({ metadata: nextSubscriptionMetadata, plan });
  if (updatedMode === "AUTO_LINK" || updatedMode === "AUTO_DEBIT") {
    await ensurePaymentRetryJob({
      subscriptionId,
      runAt: cutoffAt <= new Date(Date.now() + 5_000) ? new Date() : cutoffAt,
      maxAttempts: 1
    }).catch(() => {});
  }

  res.status(200).json({ ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true });
});

subscriptionsRouter.put("/:id/tenants", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });

  const parsed = updateSubscriptionTenantsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const tenantId = await getEffectiveTenantId(req);
  const existing = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { tenantLinks: true }
  });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
    const invalid = (parsed.data.tenantIds || []).find((t) => t !== tenantId);
    if (invalid) return res.status(403).json({ error: "tenant_forbidden" });
    if (parsed.data.primaryTenantId && parsed.data.primaryTenantId !== tenantId) {
      return res.status(403).json({ error: "tenant_forbidden" });
    }
  }

  const requestedTenantIds = Array.from(new Set((parsed.data.tenantIds || []).map((v) => String(v || "").trim()).filter(Boolean)));
  const requestedPrimary = String(parsed.data.primaryTenantId || "").trim();
  if (requestedPrimary && !requestedTenantIds.includes(requestedPrimary)) {
    return res.status(400).json({ error: "primary_tenant_not_in_list" });
  }
  const primaryTenantId = requestedPrimary || requestedTenantIds[0] || undefined;

  if (requestedTenantIds.length) {
    const countTenants = await prisma.saTenant.count({ where: { id: { in: requestedTenantIds } } });
    if (countTenants !== requestedTenantIds.length) return res.status(400).json({ error: "tenant_not_found" });
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

  res.json({ ok: true, subscription: updated });
});

subscriptionsRouter.post("/:id/recalculate-cutoff", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const tenantId = await getEffectiveTenantId(req);
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: true,
      tenantLinks: true,
      payments: {
        where: { status: PaymentStatus.APPROVED },
        orderBy: [{ paidAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
        take: 1
      }
    }
  });
  if (!subscription) return res.status(404).json({ error: "subscription_not_found" });
  if (tenantId) {
    const allowed = subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }
  if (!subscription.plan) return res.status(409).json({ error: "plan_not_found" });

  const lastPayment = subscription.payments?.[0];
  const lastApprovedAt = lastPayment?.paidAt || lastPayment?.updatedAt || lastPayment?.createdAt || null;
  const baseStart = lastApprovedAt || subscription.currentPeriodStartAt || subscription.createdAt;
  const nextEnd = addIntervalUtc(baseStart, subscription.plan.intervalUnit, subscription.plan.intervalCount);

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      currentPeriodStartAt: baseStart,
      currentPeriodEndAt: nextEnd
    }
  });

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: { path: ["subscriptionId"], equals: subscriptionId } as any
    } as any
  });

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
    await ensurePaymentRetryJob({
      subscriptionId,
      runAt: nextEnd <= new Date(Date.now() + 5_000) ? new Date() : nextEnd,
      maxAttempts: 1
    }).catch(() => {});
  }

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});
  await systemLog(LogLevel.INFO, "subscriptions.recalculate_cutoff", "Subscription cutoff recalculated", {
    subscriptionId,
    startAt: baseStart?.toISOString?.() || baseStart,
    endAt: nextEnd?.toISOString?.() || nextEnd
  }).catch(() => {});

  res.json({ ok: true, subscription: updated, startAt: baseStart, endAt: nextEnd });
});

subscriptionsRouter.post("/:id/suspend", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }
  if (existing.status === SubscriptionStatus.CANCELED) return res.status(409).json({ error: "subscription_canceled" });

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubscriptionStatus.SUSPENDED, suspendedAt: new Date() }
  });
  await systemLog(LogLevel.INFO, "subscriptions.suspend", "Subscription suspended", { subscriptionId }).catch(() => {});
  res.json({ subscription: updated });
});

subscriptionsRouter.post("/:id/cancel", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date(), suspendedAt: null }
  });
  await systemLog(LogLevel.INFO, "subscriptions.cancel", "Subscription canceled", { subscriptionId }).catch(() => {});
  res.json({ subscription: updated });
});

subscriptionsRouter.post("/:id/resume", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubscriptionStatus.ACTIVE, suspendedAt: null }
  });
  await systemLog(LogLevel.INFO, "subscriptions.resume", "Subscription resumed", { subscriptionId }).catch(() => {});
  res.json({ subscription: updated });
});

subscriptionsRouter.post("/:id/activate", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubscriptionStatus.ACTIVE, canceledAt: null, suspendedAt: null }
  });
  await systemLog(LogLevel.INFO, "subscriptions.activate", "Subscription activated", { subscriptionId }).catch(() => {});
  res.json({ subscription: updated });
});

subscriptionsRouter.post("/merge-duplicates", async (req, res) => {
  const parsed = mergeDuplicateSubscriptionsSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const tenantId = await getEffectiveTenantId(req);
  const { customerId, planId, keepSubscriptionId } = parsed.data;
  const where: any = { customerId };
  if (planId) where.planId = planId;
  if (tenantId) {
    where.OR = [{ tenantId }, { tenantLinks: { some: { tenantId } } }];
  }

  const subscriptions = await prisma.subscription.findMany({
    where,
    include: { tenantLinks: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });
  if (subscriptions.length < 2) {
    return res.status(409).json({ error: "no_duplicates_found" });
  }

  const rank = (status: SubscriptionStatus) => {
    if (status === SubscriptionStatus.ACTIVE) return 1;
    if (status === SubscriptionStatus.PAST_DUE) return 2;
    if (status === SubscriptionStatus.SUSPENDED) return 3;
    if (status === SubscriptionStatus.EXPIRED) return 4;
    if (status === SubscriptionStatus.CANCELED) return 5;
    return 9;
  };

  const keep =
    (keepSubscriptionId ? subscriptions.find((s) => s.id === keepSubscriptionId) : null) ||
    [...subscriptions].sort((a, b) => {
      const byStatus = rank(a.status as SubscriptionStatus) - rank(b.status as SubscriptionStatus);
      if (byStatus !== 0) return byStatus;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })[0];

  if (!keep) return res.status(404).json({ error: "subscription_not_found" });

  const mergeSubs = subscriptions.filter((s) => s.id !== keep.id);
  if (!mergeSubs.length) return res.status(409).json({ error: "no_duplicates_found" });
  const mergeIds = mergeSubs.map((s) => s.id);

  const tenantIdsToMove = Array.from(
    new Set(
      mergeSubs.flatMap((s) => [s.tenantId, ...(s.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))
    )
  ) as string[];
  const keptTenantIds = new Set([keep.tenantId, ...(keep.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean));
  const tenantLinksToCreate = tenantIdsToMove
    .filter((id) => !keptTenantIds.has(id))
    .map((id) => ({ subscriptionId: keep.id, tenantId: id }));

  const moved = await prisma.$transaction(async (tx) => {
    const [payments, paymentLinks, chatwootMessages] = await Promise.all([
      tx.payment.updateMany({ where: { subscriptionId: { in: mergeIds } }, data: { subscriptionId: keep.id } }),
      tx.paymentLink.updateMany({ where: { subscriptionId: { in: mergeIds } }, data: { subscriptionId: keep.id } }),
      tx.chatwootMessage.updateMany({ where: { subscriptionId: { in: mergeIds } }, data: { subscriptionId: keep.id } })
    ]);

    if (tenantLinksToCreate.length) {
      await tx.subscriptionTenant.createMany({
        data: tenantLinksToCreate,
        skipDuplicates: true
      });
    }
    await tx.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: mergeIds } } });
    await tx.subscription.deleteMany({ where: { id: { in: mergeIds } } });

    return {
      payments: Number(payments.count || 0),
      paymentLinks: Number(paymentLinks.count || 0),
      chatwootMessages: Number(chatwootMessages.count || 0),
      subscriptionsDeleted: mergeIds.length
    };
  });

  await systemLog(LogLevel.WARN, "subscriptions.merge_duplicates", "Duplicate subscriptions merged", {
    customerId,
    planId: planId || null,
    keepSubscriptionId: keep.id,
    mergedSubscriptionIds: mergeIds,
    moved
  }).catch(() => {});

  return res.json({
    ok: true,
    keepSubscriptionId: keep.id,
    mergedSubscriptionIds: mergeIds,
    moved
  });
});

subscriptionsRouter.delete("/:id", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) {
    console.error('[Subscriptions/Delete] ID no proporcionado');
    return res.status(400).json({ error: "id_invalido", mensaje: "El ID de la suscripción es requerido" });
  }
  
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) {
    console.warn('[Subscriptions/Delete] Suscripción no encontrada', { subscriptionId });
    return res.status(404).json({ error: "suscripcion_no_encontrada", mensaje: `La suscripción ${subscriptionId} no existe` });
  }
  
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) {
      console.warn('[Subscriptions/Delete] Acceso denegado', { subscriptionId, tenantId });
      return res.status(404).json({ error: "suscripcion_no_encontrada", mensaje: "No tienes acceso a esta suscripción" });
    }
  }
  
  const force = String((req as any)?.query?.force || "").trim() === "1";
  if (!force && existing.status !== SubscriptionStatus.CANCELED) {
    console.warn('[Subscriptions/Delete] Suscripción debe estar cancelada', {
      subscriptionId,
      status: existing.status
    });
    return res.status(409).json({ 
      error: "suscripcion_debe_estar_cancelada",
      mensaje: "La suscripción debe estar cancelada para eliminarla (usa force=1 para forzar)"
    });
  }

  const [paymentsCount, paymentLinksCount, chatwootCount, gamificationScoreCount, gamificationEventCount] = await Promise.all([
    prisma.payment.count({ where: { subscriptionId } }),
    prisma.paymentLink.count({ where: { subscriptionId } }),
    prisma.chatwootMessage.count({ where: { subscriptionId } }),
    prisma.gamificationScore.count({ where: { entityType: GamificationEntityType.SUBSCRIPTION, entityId: subscriptionId } }),
    prisma.gamificationEvent.count({ where: { entityType: GamificationEntityType.SUBSCRIPTION, entityId: subscriptionId } })
  ]);
  
  if (!force && (paymentsCount || paymentLinksCount || chatwootCount || gamificationScoreCount || gamificationEventCount)) {
    console.warn('[Subscriptions/Delete] Suscripción tiene dependencias', {
      subscriptionId,
      paymentsCount,
      paymentLinksCount,
      chatwootCount,
      gamificationScoreCount,
      gamificationEventCount
    });
    return res.status(409).json({
      error: "suscripcion_tiene_dependencias",
      mensaje: "La suscripción tiene registros relacionados",
      detalles: { paymentsCount, paymentLinksCount, chatwootCount, gamificationScoreCount, gamificationEventCount }
    });
  }

  const purgePayments = String((req as any)?.query?.purgePayments || "").trim() === "1";

  try {
    if (force) {
      console.log('[Subscriptions/Delete] Iniciando eliminación en cascada', { subscriptionId });
      const payments = await prisma.payment.findMany({ where: { subscriptionId }, select: { id: true } });
      const paymentIds = payments.map((p: any) => p.id);
      
      // FIX: Eliminar gamificación primero
      if (gamificationEventCount > 0) {
        await prisma.gamificationEvent.deleteMany({
          where: { entityType: GamificationEntityType.SUBSCRIPTION, entityId: subscriptionId }
        }).catch((err) => {
          console.error('[Subscriptions/Delete] Fallo eliminando gamification events', {
            subscriptionId,
            error: err?.message
          });
        });
      }

      if (gamificationScoreCount > 0) {
        await prisma.gamificationScore.deleteMany({
          where: { entityType: GamificationEntityType.SUBSCRIPTION, entityId: subscriptionId }
        }).catch((err) => {
          console.error('[Subscriptions/Delete] Fallo eliminando gamification scores', {
            subscriptionId,
            error: err?.message
          });
        });
      }
      
      if (paymentIds.length && !purgePayments) {
        console.warn('[Subscriptions/Delete] Suscripción tiene payments, use purgePayments=1', {
          subscriptionId,
          paymentsCount: paymentIds.length
        });
        return res.status(409).json({
          error: "suscripcion_tiene_payments",
          mensaje: "Use purgePayments=1 para eliminar con payments",
          paymentsCount: paymentIds.length
        });
      }
      if (paymentIds.length && purgePayments) {
        await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
      }
      await prisma.paymentLink.deleteMany({ where: { subscriptionId } }).catch(() => {});
      await prisma.chatwootMessage.deleteMany({ where: { subscriptionId } }).catch(() => {});
      if (purgePayments) {
        await prisma.payment.deleteMany({ where: { subscriptionId } }).catch(() => {});
      }
      console.log('[Subscriptions/Delete] Eliminación en cascada completada', {
        subscriptionId,
        paymentsDeleted: paymentIds.length
      });
    }

    await prisma.subscription.delete({ where: { id: subscriptionId } });
    await systemLog(LogLevel.INFO, "subscriptions.delete", "Subscription deleted", { 
      subscriptionId,
      force,
      purgePayments
    }).catch((err) => {
      console.error('[Subscriptions/Delete] Fallo creando systemLog', { 
        subscriptionId, 
        error: err?.message 
      });
    });
    console.log('[Subscriptions/Delete] Suscripción eliminada exitosamente', { subscriptionId, force });
    res.json({ ok: true });
  } catch (err: any) {
    if (String(err?.code) === "P2025") {
      console.warn('[Subscriptions/Delete] Suscripción ya no existe', { subscriptionId });
      return res.status(404).json({ error: "suscripcion_no_encontrada", mensaje: "La suscripción ya fue eliminada" });
    }
    if (String(err?.code) === "P2003") {
      console.error('[Subscriptions/Delete] Violación de clave foránea', {
        subscriptionId,
        constraint: err?.meta?.constraint_name || 'desconocida'
      });
      return res.status(409).json({ error: "suscripcion_tiene_dependencias", mensaje: "La suscripción tiene registros relacionados que impiden su eliminación" });
    }
    console.error('[Subscriptions/Delete] Error eliminando suscripción', {
      subscriptionId,
      error: err?.message || String(err),
      stack: err?.stack
    });
    res.status(500).json({ error: "fallo_eliminacion", mensaje: "No se pudo eliminar la suscripción" });
  }
});
