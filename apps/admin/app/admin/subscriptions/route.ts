import { z } from "zod";
import { prisma } from "@suscripciones/database";
import {
  LogLevel,
  PaymentStatus,
  SubscriptionStatus,
  RetryJobStatus,
  RetryJobType,
  GamificationEntityType
} from "@prisma/client";
import { requireAdminToken } from "../_lib/requireAdminToken";
import { reqToCompat } from "../_lib/reqCompat";
import { addIntervalUtc } from "@suscripciones/core/lib/dates";
import { systemLog } from "@suscripciones/core/services/systemLog";
import {
  createAutoDebitTransactionForSubscription,
  createPaymentLinkForSubscription,
  readSubscriptionTotalInCents
} from "@suscripciones/core/services/subscriptionBilling";
import { reconcileWompiTransaction } from "@suscripciones/core/services/wompiReconcile";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { consumeApp } from "@suscripciones/core/services/superAdminApp";
import { getEffectiveTenantId, getEffectiveTenantIds, readTenantIdsFromReq } from "@suscripciones/core/services/tenantContext";
import { ensurePaymentRetryJob } from "@suscripciones/core/services/retryJobScheduler";
import { validateWompiCurrency } from "@suscripciones/core/lib/wompiSignature";
import { computeBillingCycleDueAt } from "@suscripciones/core/services/billingCycles";
import { getPaymentsConfig } from "@suscripciones/core/services/runtimeConfig";
import { listSubscriptions } from "../_services/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function hasUsablePaymentSource(metadata: any) {
  const candidates = [
    metadata?.wompi?.paymentSourceId,
    metadata?.wompi?.payment_source_id,
    metadata?.paymentSourceId,
    metadata?.payment_source_id
  ];
  return candidates.some((value) => {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") {
      const normalized = value.trim();
      if (!normalized) return false;
      if (/^(null|undefined)$/i.test(normalized)) return false;
      if (/^\d+$/.test(normalized)) return true;
      if (/^src[_-]/i.test(normalized)) return true;
      return normalized.length >= 6;
    }
    return false;
  });
}

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

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const skipRaw = Number(url.searchParams.get("skip") ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(url.searchParams.get("q") ?? "").trim();
  const customerId = String(url.searchParams.get("customerId") ?? "").trim();
  const estado = String(url.searchParams.get("estado") ?? "").trim();
  const collectionMode = String(url.searchParams.get("collectionMode") ?? "").trim();
  const idsParam = url.searchParams.get("ids");
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (idsParam !== null && (idsEmpty || ids.length === 0)) {
    return Response.json({ items: [], total: 0 });
  }

  const result = await listSubscriptions({ tenantId, take, skip, q, customerId, estado, collectionMode, ids });
  return Response.json({ items: result.items, total: result.total });
}

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[Subscriptions/Create] Validación fallida", {
      error: parsed.error.flatten(),
      body
    });
    return Response.json({ error: "cuerpo_invalido", detalles: parsed.error.flatten() }, { status: 400 });
  }

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: parsed.data.planId }, include: { tenantLinks: true } });
  if (!plan) {
    console.warn("[Subscriptions/Create] Plan no encontrado", { planId: parsed.data.planId });
    return Response.json({ error: "plan_no_encontrado", mensaje: `El plan ${parsed.data.planId} no existe` }, { status: 404 });
  }

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) {
    console.warn("[Subscriptions/Create] Customer no encontrado", { customerId: parsed.data.customerId });
    return Response.json({ error: "customer_no_encontrado", mensaje: `El customer ${parsed.data.customerId} no existe` }, { status: 404 });
  }
  const planTenantIds = Array.from(new Set([plan.tenantId, ...(plan.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))) as string[];
  const compatReq = reqToCompat(req, body);
  const requestedTenantIds = readTenantIdsFromReq(compatReq);
  const fallbackTenantIds = requestedTenantIds.length ? requestedTenantIds : planTenantIds;
  const effectiveTenantIds = fallbackTenantIds.length ? fallbackTenantIds : (await getEffectiveTenantIds(compatReq));
  if (!effectiveTenantIds.length) {
    console.error("[Subscriptions/Create] Tenant requerido pero no proporcionado");
    return Response.json({ error: "tenant_requerido", mensaje: "Debe pertenecer al menos a un tenant" }, { status: 400 });
  }

  if (planTenantIds.length) {
    const invalid = effectiveTenantIds.find((t) => !planTenantIds.includes(t));
    if (invalid) {
      console.error("[Subscriptions/Create] Tenant no permitido para este plan", {
        tenantId: invalid,
        planId: plan.id,
        allowedTenantIds: planTenantIds
      });
      return Response.json({ error: "tenant_no_permitido_para_plan", mensaje: "El tenant no está permitido para este plan" }, { status: 409 });
    }
  }
  if (customer.tenantId && !effectiveTenantIds.includes(customer.tenantId)) {
    console.error("[Subscriptions/Create] Mismatch de tenant", {
      customerId: customer.id,
      customerTenantId: customer.tenantId,
      effectiveTenantIds
    });
    return Response.json({ error: "tenant_mismatch", mensaje: "El customer no pertenece al tenant especificado" }, { status: 409 });
  }
  if (!customer.tenantId) {
    const linked = await prisma.customerTenant.findFirst({
      where: { customerId: customer.id, tenantId: { in: effectiveTenantIds } }
    });
    if (!linked) {
      console.error("[Subscriptions/Create] Customer sin link a tenant", {
        customerId: customer.id,
        tenantIds: effectiveTenantIds
      });
      return Response.json({ error: "tenant_mismatch", mensaje: "El customer no está vinculado al tenant especificado" }, { status: 409 });
    }
  }
  if (!parsed.data.allowDuplicate) {
    const catalogItemId = String((plan.metadata as any)?.catalog?.itemId || "").trim();
    const activeStatuses = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED, SubscriptionStatus.EXPIRED];
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
      console.warn("[Subscriptions/Create] Suscripción duplicada detectada", {
        customerId: parsed.data.customerId,
        planId: parsed.data.planId,
        duplicatesCount,
        catalogItemId
      });
      return Response.json({
        error: "suscripcion_duplicada_requiere_aprobacion",
        mensaje: "Ya existe una suscripción activa para este customer y plan",
        detalles: {
          duplicatesCount,
          customerId: parsed.data.customerId,
          planId: parsed.data.planId,
          catalogItemId: catalogItemId || null
        }
      }, { status: 409 });
    }
  }
  const tenantId = effectiveTenantIds[0];

  const collectionMode = String((plan.metadata as any)?.collectionMode || "MANUAL_LINK");
  const paymentSourceId = (() => {
    const meta = (customer.metadata as any) ?? {};
    const candidates = [meta?.wompi?.paymentSourceId, meta?.wompi?.payment_source_id, meta?.paymentSourceId, meta?.payment_source_id];
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
    console.error("[Subscriptions/Create] firstPeriodEndAt inválido", { firstPeriodEndAt: parsed.data.firstPeriodEndAt });
    return Response.json({ error: "first_period_end_at_invalido", mensaje: "La fecha firstPeriodEndAt no es válida" }, { status: 400 });
  }
  if (periodEnd < startAt) {
    console.error("[Subscriptions/Create] firstPeriodEndAt anterior a startAt", { startAt, periodEnd });
    return Response.json({ error: "first_period_end_anterior_a_start", mensaje: "La fecha de fin del período debe ser posterior a la fecha de inicio" }, { status: 400 });
  }

  const subscriptionMetaBase = parsed.data.metadata && typeof parsed.data.metadata === "object" ? (parsed.data.metadata as any) : {};
  const paymentsConfig = await getPaymentsConfig().catch(() => null);
  const cycleStartDay = Math.max(1, Math.min(31, Math.trunc(paymentsConfig?.defaultCycleStartDay || 1)));
  const paymentDay = Math.max(1, Math.min(31, Math.trunc(paymentsConfig?.defaultPaymentDay || cycleStartDay)));
  const paymentTiming = String(paymentsConfig?.defaultPaymentTiming || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";
  const graceDays = Math.max(0, Math.trunc(paymentsConfig?.defaultGraceDays || 0));
  const dueAt =
    plan.intervalUnit === "MONTH"
      ? computeBillingCycleDueAt({
          periodStartAt: startAt,
          periodEndAt: periodEnd,
          cycleStartDay,
          paymentDay,
          paymentTiming
        })
      : periodEnd;
  const dueWithGraceAt = new Date(dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);

  try {
    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        customerId: parsed.data.customerId,
        planId: plan.id,
        status: dueWithGraceAt.getTime() < Date.now() ? SubscriptionStatus.PAST_DUE : SubscriptionStatus.ACTIVE,
        startAt,
        currentPeriodStartAt: startAt,
        currentPeriodEndAt: periodEnd,
        currentCycle: 1,
        cycleStartDay,
        paymentDay,
        paymentTiming,
        graceDays,
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
      console.error("[Subscriptions/Create] Fallo programando notificaciones", {
        subscriptionId: subscription.id,
        error: err?.message
      });
    });

    const runAt = dueAt <= new Date(Date.now() + 5_000) ? new Date() : dueAt;

    if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
      await ensurePaymentRetryJob({ subscriptionId: subscription.id, runAt, maxAttempts: 1 }).catch((err) => {
        console.error("[Subscriptions/Create] Fallo encolando retry job", {
          subscriptionId: subscription.id,
          error: err?.message
        });
      });
      const isDueNow = runAt.getTime() <= Date.now() + 5_000;
      const shouldCreateLinkNow = collectionMode === "AUTO_LINK" ? parsed.data.createPaymentLink && isDueNow : false;

      if (!shouldCreateLinkNow) {
        console.log("[Subscriptions/Create] Suscripción creada exitosamente", {
          subscriptionId: subscription.id,
          scheduled: true,
          collectionMode
        });
        return Response.json({ subscription, scheduled: true }, { status: 201 });
      }

      try {
        const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
        console.log("[Subscriptions/Create] Suscripción con link de pago creado", {
          subscriptionId: subscription.id,
          paymentLinkId: link.wompiPaymentLinkId
        });
        return Response.json(
          { subscription, scheduled: true, ...link, paymentSourceMissing: collectionMode === "AUTO_DEBIT" && !hasPaymentSource },
          { status: 201 }
        );
      } catch (err: any) {
        console.error("[Subscriptions/Create] Fallo creando link de pago", {
          subscriptionId: subscription.id,
          error: err?.message
        });
        await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
          subscriptionId: subscription.id,
          err: err?.message ? String(err.message) : "unknown error"
        }).catch(() => {});
        return Response.json({ subscription, scheduled: true, paymentLinkError: "fallo_creando_link_de_pago" }, { status: 201 });
      }
    }

    if (!parsed.data.createPaymentLink) {
      console.log("[Subscriptions/Create] Suscripción creada exitosamente", {
        subscriptionId: subscription.id
      });
      return Response.json({ subscription }, { status: 201 });
    }

    try {
      const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
      console.log("[Subscriptions/Create] Suscripción con link de pago creado", {
        subscriptionId: subscription.id,
        paymentLinkId: link.wompiPaymentLinkId
      });
      return Response.json({ subscription, ...link }, { status: 201 });
    } catch (err: any) {
      console.error("[Subscriptions/Create] Fallo creando link de pago", {
        subscriptionId: subscription.id,
        error: err?.message
      });
      await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
        subscriptionId: subscription.id,
        err: err?.message ? String(err.message) : "unknown error"
      }).catch(() => {});
      return Response.json({ subscription, paymentLinkError: "fallo_creando_link_de_pago" }, { status: 201 });
    }
  } catch (err: any) {
    console.error("[Subscriptions/Create] Error creando suscripción", {
      customerId: parsed.data.customerId,
      planId: parsed.data.planId,
      error: err?.message || String(err),
      stack: err?.stack
    });
    throw err;
  }
}
