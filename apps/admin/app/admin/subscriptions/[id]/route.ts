import { prisma } from "@suscripciones/database";
import {
  LogLevel,
  PaymentStatus,
  RetryJobStatus,
  RetryJobType,
  SubscriptionStatus,
  GamificationEntityType
} from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { addIntervalUtc } from "@suscripciones/core/lib/dates";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { createAutoDebitTransactionForSubscription, createPaymentLinkForSubscription, readSubscriptionTotalInCents } from "@suscripciones/core/services/subscriptionBilling";
import { advanceSubscriptionCycle } from "@suscripciones/core/services/wompiService";
import { reconcileWompiTransaction } from "@suscripciones/core/services/wompiReconcile";
import { getAutoDebitConfig } from "@suscripciones/core/services/runtimeConfig";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { ensurePaymentRetryJob } from "@suscripciones/core/services/retryJobScheduler";
import { validateWompiCurrency } from "@suscripciones/core/lib/wompiSignature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createPaymentLinkSchema = {
  safeParse: (body: any) => {
    const amountInCents = body?.amountInCents;
    if (amountInCents === undefined) return { success: true, data: {} as any };
    if (!Number.isFinite(amountInCents) || Number(amountInCents) <= 0 || Math.floor(Number(amountInCents)) !== Number(amountInCents)) {
      return { success: false, error: { flatten: () => ({ fieldErrors: { amountInCents: ["invalid_number"] } }) } } as any;
    }
    return { success: true, data: { amountInCents: Number(amountInCents) } as any };
  }
};

const chargeNowSchema = {
  safeParse: (body: any) => {
    const amountInCents = body?.amountInCents;
    if (amountInCents === undefined) return { success: true, data: {} as any };
    if (!Number.isFinite(amountInCents) || Number(amountInCents) <= 0 || Math.floor(Number(amountInCents)) !== Number(amountInCents)) {
      return { success: false, error: { flatten: () => ({ fieldErrors: { amountInCents: ["invalid_number"] } }) } } as any;
    }
    return { success: true, data: { amountInCents: Number(amountInCents) } as any };
  }
};

const scheduleCutoffSchema = {
  safeParse: (body: any) => {
    const cutoffAt = body?.cutoffAt;
    if (!cutoffAt || typeof cutoffAt !== "string") {
      return { success: false, error: { flatten: () => ({ fieldErrors: { cutoffAt: ["required"] } }) } } as any;
    }
    return { success: true, data: { cutoffAt } as any };
  }
};

const changePlanSchema = {
  safeParse: (body: any) => {
    const planId = body?.planId;
    const cutoffAt = body?.cutoffAt;
    if (!planId || !cutoffAt) {
      return { success: false, error: { flatten: () => ({ fieldErrors: { planId: ["required"], cutoffAt: ["required"] } }) } } as any;
    }
    return {
      success: true,
      data: {
        planId: String(planId),
        cutoffAt: String(cutoffAt),
        shippingInCents: body?.shippingInCents,
        freeShipping: body?.freeShipping
      }
    } as any;
  }
};

const updateSubscriptionTenantsSchema = {
  safeParse: (body: any) => {
    const tenantIds = Array.isArray(body?.tenantIds) ? body.tenantIds : undefined;
    const primaryTenantId = body?.primaryTenantId;
    return { success: true, data: { tenantIds, primaryTenantId } as any };
  }
};

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const subscriptionId = String(params?.id || "").trim();
  const action = String(new URL(req.url).searchParams.get("action") || "").trim();

  if (action === "payment-link") {
    const body = await req.json().catch(() => null);
    const parsed = createPaymentLinkSchema.safeParse(body ?? {});
    if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    const compatReq = reqToCompat(req, body);
    const tenantId = await getEffectiveTenantId(compatReq);
    if (tenantId) {
      const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
      if (!existing) return Response.json({ error: "subscription_not_found" }, { status: 404 });
      const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
      if (!allowed) return Response.json({ error: "subscription_not_found" }, { status: 404 });
    }
    try {
      const link = await createPaymentLinkForSubscription({
        subscriptionId,
        amountInCentsOverride: (parsed as any).data.amountInCents
      });
      return Response.json(link, { status: 201 });
    } catch (err: any) {
      await systemLog(LogLevel.ERROR, "subscriptions.payment_link", "Payment link create failed", {
        subscriptionId,
        err: err?.message ? String(err.message) : "unknown error"
      }).catch(() => {});
      return Response.json({ error: "wompi_payment_link_failed" }, { status: 502 });
    }
  }

  if (action === "charge-now") {
    const body = await req.json().catch(() => null);
    const parsed = chargeNowSchema.safeParse(body ?? {});
    if (!parsed.success) {
      await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: invalid body", {
        subscriptionId,
        details: parsed.error.flatten()
      }).catch(() => {});
      return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const compatReq = reqToCompat(req, body);
    const tenantId = await getEffectiveTenantId(compatReq);
    await systemLog(LogLevel.INFO, "subscriptions.charge_now", "Manual charge requested", {
      subscriptionId,
      tenantId: tenantId || null,
      amountInCentsOverride: (parsed as any).data.amountInCents ?? null
    }).catch(() => {});
    let subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, customer: true, tenantLinks: true }
    });
    if (!subscription) {
      await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: subscription not found", {
        subscriptionId,
        tenantId: tenantId || null
      }).catch(() => {});
      return Response.json({ error: "subscription_not_found" }, { status: 404 });
    }
    if (tenantId) {
      const allowed =
        subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
      if (!allowed) {
        await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: tenant mismatch", {
          subscriptionId,
          requestedTenantId: tenantId,
          subscriptionTenantId: subscription.tenantId || null,
          tenantLinks: (subscription.tenantLinks || []).map((t: any) => t.tenantId)
        }).catch(() => {});
        return Response.json({
          error: "subscription_not_found",
          details: {
            requestedTenantId: tenantId,
            subscriptionTenantId: subscription.tenantId || null,
            tenantLinks: (subscription.tenantLinks || []).map((t: any) => t.tenantId)
          }
        }, { status: 404 });
      }
    }

    const collectionMode = resolveSubscriptionCollectionMode(subscription);
    if (collectionMode !== "AUTO_DEBIT") {
      const paymentId = await recordManualChargeFailure({
        subscription,
        amountInCentsOverride: (parsed as any).data.amountInCents,
        errorCode: "manual_charge_not_allowed",
        details: { collectionMode }
      }).catch(() => null);
      await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: invalid collection mode", {
        subscriptionId,
        tenantId: tenantId || null,
        paymentId,
        collectionMode
      }).catch(() => {});
      return Response.json({ error: "manual_charge_not_allowed", details: { collectionMode }, ...(paymentId ? { paymentId } : {}) }, { status: 409 });
    }
    const autoDebitCfg = await getAutoDebitConfig();
    if (!autoDebitCfg.allowManualCharge) {
      const paymentId = await recordManualChargeFailure({
        subscription,
        amountInCentsOverride: (parsed as any).data.amountInCents,
        errorCode: "manual_charge_disabled_by_settings"
      }).catch(() => null);
      await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: disabled by settings", {
        subscriptionId,
        tenantId: tenantId || null,
        paymentId
      }).catch(() => {});
      return Response.json({ error: "manual_charge_disabled_by_settings", ...(paymentId ? { paymentId } : {}) }, { status: 409 });
    }

    const now = new Date();
    const approvedForCycle = await prisma.payment.findUnique({
      where: { subscriptionCycleKey: `${subscription.id}:${subscription.currentCycle ?? 1}` },
      select: { id: true, status: true, paidAt: true, updatedAt: true, createdAt: true }
    });
    if (approvedForCycle?.status === PaymentStatus.APPROVED) {
      const approvedAt = approvedForCycle.paidAt || approvedForCycle.updatedAt || approvedForCycle.createdAt || now;
      const currentEnd = subscription.currentPeriodEndAt ? new Date(subscription.currentPeriodEndAt) : null;
      if (currentEnd && now.getTime() + 5_000 >= currentEnd.getTime()) {
        await advanceSubscriptionCycle({
          subscriptionId: subscription.id,
          cycle: subscription.currentCycle ?? 1,
          paidAt: new Date(approvedAt)
        }).catch(() => {});
        const refreshed = await prisma.subscription.findUnique({
          where: { id: subscription.id },
          include: { plan: true, customer: true, tenantLinks: true }
        });
        if (refreshed) {
          subscription = refreshed;
        }
      } else {
        return Response.json(
          {
            error: "payment_already_approved",
            paymentId: approvedForCycle.id,
            paidAt: approvedAt instanceof Date ? approvedAt.toISOString() : approvedAt
          },
          { status: 409 }
        );
      }
    }
    const latestApproved = await prisma.payment.findFirst({
      where: { subscriptionId, status: PaymentStatus.APPROVED },
      orderBy: [{ paidAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
      select: { paidAt: true, updatedAt: true, createdAt: true }
    });
    const lastApprovedAt = latestApproved?.paidAt || latestApproved?.updatedAt || latestApproved?.createdAt || null;
    const dueByLastPayment = lastApprovedAt ? addIntervalUtc(lastApprovedAt, subscription.plan.intervalUnit, subscription.plan.intervalCount) : null;
    const dueByCutoff = subscription.currentPeriodEndAt ? new Date(subscription.currentPeriodEndAt) : null;
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
        amountInCentsOverride: (parsed as any).data.amountInCents,
        errorCode: "charge_not_due_yet",
        details
      }).catch(() => null);
      await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: not due yet", {
        subscriptionId,
        tenantId: tenantId || null,
        paymentId,
        ...details
      }).catch(() => {});
      return Response.json({ error: "charge_not_due_yet", details, ...(paymentId ? { paymentId } : {}) }, { status: 409 });
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
      if (recentPending.wompiTransactionId && tenantId) {
        await reconcileWompiTransaction({
          wompiTransactionId: recentPending.wompiTransactionId,
          tenantId,
          checksumPrefix: "manual-charge-precheck"
        }).catch(() => {});
        const refreshed = await prisma.payment.findUnique({
          where: { id: recentPending.id },
          select: { status: true }
        });
        if (!(refreshed && refreshed.status !== PaymentStatus.PENDING)) {
          const details = {
            paymentId: recentPending.id,
            wompiTransactionId: recentPending.wompiTransactionId,
            createdAt: recentPending.createdAt
          };
          const failedPaymentId = await recordManualChargeFailure({
            subscription,
            amountInCentsOverride: (parsed as any).data.amountInCents,
            errorCode: "pending_charge_exists",
            details
          }).catch(() => null);
          await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: pending payment exists", {
            subscriptionId,
            tenantId: tenantId || null,
            paymentId: failedPaymentId || recentPending.id,
            pendingPaymentId: recentPending.id,
            wompiTransactionId: recentPending.wompiTransactionId
          }).catch(() => {});
          return Response.json({ error: "pending_charge_exists", details, paymentId: failedPaymentId || recentPending.id }, { status: 409 });
        }
      } else {
        const details = {
          paymentId: recentPending.id,
          wompiTransactionId: recentPending.wompiTransactionId,
          createdAt: recentPending.createdAt
        };
        const failedPaymentId = await recordManualChargeFailure({
          subscription,
          amountInCentsOverride: (parsed as any).data.amountInCents,
          errorCode: "pending_charge_exists",
          details
        }).catch(() => null);
        await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: pending payment exists", {
          subscriptionId,
          tenantId: tenantId || null,
          paymentId: failedPaymentId || recentPending.id,
          pendingPaymentId: recentPending.id,
          wompiTransactionId: recentPending.wompiTransactionId
        }).catch(() => {});
        return Response.json({ error: "pending_charge_exists", details, paymentId: failedPaymentId || recentPending.id }, { status: 409 });
      }
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
        amountInCentsOverride: (parsed as any).data.amountInCents,
        errorCode: "customer_payment_source_missing",
        details
      }).catch(() => null);
      await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: payment source missing", {
        subscriptionId,
        tenantId: tenantId || null,
        paymentId,
        ...details
      }).catch(() => {});
      return Response.json({ error: "customer_payment_source_missing", details, ...(paymentId ? { paymentId } : {}) }, { status: 409 });
    }
    if (!subscription.customer?.email) {
      const paymentId = await recordManualChargeFailure({
        subscription,
        amountInCentsOverride: (parsed as any).data.amountInCents,
        errorCode: "customer_email_required"
      }).catch(() => null);
      await systemLog(LogLevel.WARN, "subscriptions.charge_now", "Manual charge blocked: customer email missing", {
        subscriptionId,
        tenantId: tenantId || null,
        paymentId,
        customerId: subscription.customerId
      }).catch(() => {});
      return Response.json({ error: "customer_email_required", ...(paymentId ? { paymentId } : {}) }, { status: 409 });
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
    await systemLog(LogLevel.INFO, "subscriptions.charge_now", "Manual charge passed prechecks", {
      subscriptionId,
      tenantId: tenantId || null,
      customerId: subscription.customerId,
      cycle: subscription.currentCycle ?? 1,
      collectionMode,
      paymentSourceId: Number(paymentSource)
    }).catch(() => {});

    try {
      const result = await createAutoDebitTransactionForSubscription({
        subscriptionId,
        amountInCentsOverride: (parsed as any).data.amountInCents,
        forceNewTransaction: true
      });
      await systemLog(LogLevel.INFO, "subscriptions.charge_now", "Manual charge transaction requested", {
        subscriptionId,
        tenantId: tenantId || null,
        paymentId: result.paymentId,
        wompiTransactionId: result.wompiTransactionId
      }).catch(() => {});
      return Response.json({ ok: true, ...result, manualChargeAt }, { status: 201 });
    } catch (err: any) {
      const paymentId =
        (
          await prisma.payment
            .findUnique({
              where: { subscriptionCycleKey: `${subscription.id}:${Number(subscription.currentCycle || 1)}` },
              select: { id: true }
            })
            .catch(() => null)
        )?.id || null;
      await systemLog(LogLevel.ERROR, "subscriptions.charge_now", "Manual charge failed", {
        subscriptionId,
        paymentId,
        err: err?.message ? String(err.message) : "unknown error"
      }).catch(() => {});
      return Response.json({ error: err?.message || "charge_now_failed", ...(paymentId ? { paymentId } : {}) }, { status: 502 });
    }
  }

  if (action === "schedule-cutoff") {
    const body = await req.json().catch(() => null);
    const parsed = scheduleCutoffSchema.safeParse(body ?? {});
    if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

    const cutoffAtRaw = String(parsed.data.cutoffAt || "").trim();
    const cutoffAt = new Date(cutoffAtRaw);
    if (!cutoffAtRaw || Number.isNaN(cutoffAt.getTime())) return Response.json({ error: "invalid_cutoff_date" }, { status: 400 });

    const compatReq = reqToCompat(req, body);
    const tenantId = await getEffectiveTenantId(compatReq);
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, tenantLinks: true }
    });
    if (!subscription) return Response.json({ error: "subscription_not_found" }, { status: 404 });
    if (tenantId) {
      const allowed =
        subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
      if (!allowed) return Response.json({ error: "subscription_not_found" }, { status: 404 });
    }

    const collectionMode = resolveSubscriptionCollectionMode(subscription);
    if (collectionMode !== "AUTO_DEBIT" && collectionMode !== "AUTO_LINK") {
      return Response.json({ error: "schedule_cutoff_not_allowed" }, { status: 409 });
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

    return Response.json({ ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true }, { status: 200 });
  }

  if (action === "change-plan") {
    const body = await req.json().catch(() => null);
    const parsed = changePlanSchema.safeParse(body ?? {});
    if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

    const cutoffAtRaw = String(parsed.data.cutoffAt || "").trim();
    const cutoffAt = new Date(cutoffAtRaw);
    if (!cutoffAtRaw || Number.isNaN(cutoffAt.getTime())) return Response.json({ error: "invalid_cutoff_date" }, { status: 400 });

    const compatReq = reqToCompat(req, body);
    const tenantId = await getEffectiveTenantId(compatReq);
    const [subscription, plan] = await Promise.all([
      prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true, plan: true } }),
      prisma.subscriptionPlan.findUnique({ where: { id: (parsed as any).data.planId }, include: { tenantLinks: true } })
    ]);
    if (!subscription) return Response.json({ error: "subscription_not_found" }, { status: 404 });
    if (!plan) return Response.json({ error: "plan_not_found" }, { status: 404 });
    if (tenantId) {
      const allowed =
        subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
      if (!allowed) return Response.json({ error: "subscription_not_found" }, { status: 404 });
      const allowedPlan = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
      if (!allowedPlan) return Response.json({ error: "plan_not_found" }, { status: 404 });
    }

    const planMeta = (plan.metadata as any) ?? {};
    const sourcePlanId = String(plan.id || "");
    const catalog = planMeta?.catalog ?? {};
    const pricing = readPlanPricing(planMeta);
    const kind = String(catalog?.kind || "").toUpperCase();
    const requiresShipping = kind !== "SERVICE";
    const defaultShippingInCents = Number(pricing?.shippingInCents || 0);
    const requestedShippingInCents = requiresShipping
      ? ((parsed as any).data.freeShipping ? 0 : Number((parsed as any).data.shippingInCents ?? defaultShippingInCents))
      : 0;

    if (requiresShipping && !(parsed as any).data.freeShipping && requestedShippingInCents <= 0) {
      return Response.json({ error: "missing_shipping_amount" }, { status: 400 });
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

    const subscriptionMetaBase = subscription.metadata && typeof subscription.metadata === "object" ? (subscription.metadata as any) : {};
    const nextSubscriptionMetadata = {
      ...subscriptionMetaBase,
      collectionMode: String((plan.metadata as any)?.collectionMode || "MANUAL_LINK"),
      pricing: {
        ...(subscriptionMetaBase?.pricing && typeof subscriptionMetaBase.pricing === "object" ? subscriptionMetaBase.pricing : {}),
        sourcePlanId,
        basePriceInCents: Number(pricing?.basePriceInCents || plan.priceInCents || 0),
        variantDeltaInCents: Number(catalog?.variantDeltaInCents || 0),
        shippingInCents: requestedShippingInCents,
        subtotalInCents: totals.subtotalInCents,
        taxInCents: totals.taxInCents,
        totalInCents: totals.totalInCents,
        freeShipping: Boolean((parsed as any).data.freeShipping),
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

    return Response.json({ ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true }, { status: 200 });
  }

  if (action === "tenants") {
    const body = await req.json().catch(() => null);
    const parsed = updateSubscriptionTenantsSchema.safeParse(body ?? {}) as any;
    if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

    const compatReq = reqToCompat(req, body);
    const tenantId = await getEffectiveTenantId(compatReq);
    const existing = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { tenantLinks: true }
    });
    if (!existing) return Response.json({ error: "subscription_not_found" }, { status: 404 });
    if (tenantId) {
      const allowed =
        existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
      if (!allowed) return Response.json({ error: "subscription_not_found" }, { status: 404 });
      const invalid = ((parsed as any).data.tenantIds || []).find((t: any) => t !== tenantId);
      if (invalid) return Response.json({ error: "tenant_forbidden" }, { status: 403 });
      if ((parsed as any).data.primaryTenantId && (parsed as any).data.primaryTenantId !== tenantId) {
        return Response.json({ error: "tenant_forbidden" }, { status: 403 });
      }
    }

    const requestedTenantIds: string[] = Array.from(
      new Set(((parsed as any).data.tenantIds || []).map((v: any) => String(v || "").trim()).filter(Boolean))
    ) as string[];
    const requestedPrimary = String((parsed as any).data.primaryTenantId || "").trim();
    if (requestedPrimary && !requestedTenantIds.includes(requestedPrimary)) {
      return Response.json({ error: "primary_tenant_not_in_list" }, { status: 400 });
    }
    const primaryTenantId = requestedPrimary || requestedTenantIds[0] || undefined;

    if (requestedTenantIds.length) {
      const countTenants = await prisma.saTenant.count({ where: { id: { in: requestedTenantIds } } });
      if (countTenants !== requestedTenantIds.length) return Response.json({ error: "tenant_not_found" }, { status: 400 });
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

    return Response.json({ ok: true, subscription: updated });
  }

  if (action === "recalculate-cutoff") {
    const compatReq = reqToCompat(req);
    const tenantId = await getEffectiveTenantId(compatReq);
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
    if (!subscription) return Response.json({ error: "subscription_not_found" }, { status: 404 });
    if (tenantId) {
      const allowed =
        subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
      if (!allowed) return Response.json({ error: "subscription_not_found" }, { status: 404 });
    }
    if (!subscription.plan) return Response.json({ error: "plan_not_found" }, { status: 409 });

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

    return Response.json({ ok: true, subscription: updated, startAt: baseStart, endAt: nextEnd });
  }

  if (action === "suspend" || action === "cancel" || action === "resume" || action === "activate") {
    const compatReq = reqToCompat(req);
    const tenantId = await getEffectiveTenantId(compatReq);
    const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
    if (!existing) return Response.json({ error: "subscription_not_found" }, { status: 404 });
    if (tenantId) {
      const allowed =
        existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
      if (!allowed) return Response.json({ error: "subscription_not_found" }, { status: 404 });
    }

    if (action === "suspend") {
      if (existing.status === SubscriptionStatus.CANCELED) return Response.json({ error: "subscription_canceled" }, { status: 409 });
      const updated = await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { status: SubscriptionStatus.SUSPENDED, suspendedAt: new Date() }
      });
      await systemLog(LogLevel.INFO, "subscriptions.suspend", "Subscription suspended", { subscriptionId }).catch(() => {});
      return Response.json({ subscription: updated });
    }

    if (action === "cancel") {
      const updated = await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date(), suspendedAt: null }
      });
      await systemLog(LogLevel.INFO, "subscriptions.cancel", "Subscription canceled", { subscriptionId }).catch(() => {});
      return Response.json({ subscription: updated });
    }

    if (action === "resume") {
      const updated = await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { status: SubscriptionStatus.ACTIVE, suspendedAt: null }
      });
      await systemLog(LogLevel.INFO, "subscriptions.resume", "Subscription resumed", { subscriptionId }).catch(() => {});
      return Response.json({ subscription: updated });
    }

    if (action === "activate") {
      const updated = await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { status: SubscriptionStatus.ACTIVE, canceledAt: null, suspendedAt: null }
      });
      await systemLog(LogLevel.INFO, "subscriptions.activate", "Subscription activated", { subscriptionId }).catch(() => {});
      return Response.json({ subscription: updated });
    }
  }

  return Response.json({ error: "unknown_action" }, { status: 400 });
}
