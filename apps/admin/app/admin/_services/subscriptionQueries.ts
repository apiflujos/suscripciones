import "server-only";
import { humanizeNotificationError } from "../../lib/humanizeErrors";

const NOTICE_KIND_LABEL: Record<string, string> = {
  PAYMENT_LINK: "Link de pago",
  PAYMENT_CONFIRMED: "Confirmación de pago",
  EXPIRY_WARNING: "Aviso de vencimiento",
  PAYMENT_FAILED: "Aviso de cobro fallido"
};


import { prisma } from "@suscripciones/database";
import { PaymentStatus, Prisma, RetryJobStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { getAutoDebitConfig } from "@suscripciones/core/services/runtimeConfig";
import { getCivilDateAnchorUtc } from "@suscripciones/core/lib/dates";
import { buildSubscriptionBillingStateIndex, isBillingCyclePaid, resolveCollectionDelinquency } from "@suscripciones/core/services/billingCycles";
import { extractCustomerPaymentSourceId } from "@suscripciones/core/lib/customerMetadata";
import { collectionModePlanWhere, stringContainsJsonFilter, subscriptionIdJsonFilter } from "./subscriptionShared";

export async function listSubscriptions(args: {
  tenantId?: string | null;
  take?: number;
  skip?: number;
  q?: string;
  customerId?: string;
  estado?: string;
  collectionMode?: string;
  ids?: string[];
}) {
  const tenantId = args.tenantId || null;
  const takeRaw = Number(args.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const skipRaw = Number(args.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(args.q ?? "").trim();
  const customerId = String(args.customerId ?? "").trim();
  const estado = String(args.estado ?? "").trim();
  const collectionMode = String(args.collectionMode ?? "").trim();
  const rawIds = Array.isArray(args.ids) ? args.ids.map((v) => v.trim()).filter(Boolean) : [];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = rawIds.filter((id) => uuidRegex.test(id));

  const where: Prisma.SubscriptionWhereInput = {};
  if (tenantId) {
    const tenantFilter = { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] };
    where.AND = Array.isArray(where.AND) ? [...where.AND, tenantFilter] : [tenantFilter];
  }
  const shouldFilterByEffectiveStatus = ["mora", "si", "no"].includes(estado);

  if (customerId) {
    where.customerId = customerId;
  }

  if (collectionMode) {
    where.plan = collectionModePlanWhere(collectionMode);
  }

  if (q) {
    where.customer = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { metadata: stringContainsJsonFilter(["identificacion"], q) },
        { metadata: stringContainsJsonFilter(["identificacionNumero"], q) },
        { metadata: stringContainsJsonFilter(["documentNumber"], q) },
        { metadata: stringContainsJsonFilter(["document"], q) }
      ]
    };
  }

  if (rawIds.length && !ids.length) {
    return { items: [], total: 0 };
  }

  if (ids.length) {
    where.AND = Array.isArray(where.AND) ? [...where.AND, { id: { in: ids } }] : [{ id: { in: ids } }];
  }

  const items = await prisma.subscription.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: { customer: true, product: true, plan: { include: { tenantLinks: true } }, tenantLinks: true }
  });
  const total = await prisma.subscription.count({ where });
  const subscriptionIds = items.map((s) => s.id);
  const approvedPayments = await prisma.payment.findMany({
    where: { subscriptionId: { in: subscriptionIds }, status: PaymentStatus.APPROVED, paidAt: { not: null } },
    orderBy: { paidAt: "desc" },
    select: {
      subscriptionId: true,
      cycleNumber: true,
      createdAt: true,
      paidAt: true,
      amountInCents: true,
      currency: true,
      wompiTransactionId: true,
      reference: true,
      providerResponse: true
    }
  });

  // Cuál fue el último aviso al cliente: sin esto la lista dice que hay que
  // cobrar pero no si el cliente llegó a enterarse.
  const notices = subscriptionIds.length
    ? await prisma.chatwootMessage.findMany({
        where: { subscriptionId: { in: subscriptionIds } },
        orderBy: [{ createdAt: "desc" }],
        take: Math.max(subscriptionIds.length * 3, 60),
        select: { subscriptionId: true, type: true, status: true, errorMessage: true, sentAt: true, createdAt: true }
      })
    : [];
  const lastNoticeBySub = new Map<string, { kind: string; status: string; at: Date; reason: string | null }>();
  for (const n of notices) {
    if (!n.subscriptionId || lastNoticeBySub.has(n.subscriptionId)) continue;
    const status = String(n.status);
    lastNoticeBySub.set(n.subscriptionId, {
      kind: NOTICE_KIND_LABEL[String(n.type)] ?? "Aviso",
      status,
      at: n.sentAt ?? n.createdAt,
      reason: status === "FAILED" ? humanizeNotificationError(n.errorMessage || "") : null
    });
  }

  const lastPaymentBySub = new Map<string, { paidAt: Date; amountInCents: number; currency: string; wompiTransactionId: string | null }>();
  const approvedPaymentByCycle = new Map<string, { createdAt: Date; isManual: boolean }>();
  for (const p of approvedPayments) {
    if (!p.subscriptionId || !p.paidAt) continue;
    if (!lastPaymentBySub.has(p.subscriptionId)) lastPaymentBySub.set(p.subscriptionId, { paidAt: p.paidAt, amountInCents: p.amountInCents, currency: p.currency, wompiTransactionId: p.wompiTransactionId });
    if (typeof p.cycleNumber === "number" && Number.isFinite(p.cycleNumber)) {
      const providerResponse =
        p.providerResponse && typeof p.providerResponse === "object" ? (p.providerResponse as Record<string, unknown>) : null;
      const isManual = Boolean(providerResponse?.manual) || String(p.reference || "").startsWith("MANUAL_");
      const key = `${p.subscriptionId}:${p.cycleNumber}`;
      const current = approvedPaymentByCycle.get(key);
      if (!current || current.createdAt < p.createdAt) {
        approvedPaymentByCycle.set(key, { createdAt: p.createdAt, isManual });
      }
    }
  }

  const latestLinks = await prisma.paymentLink.findMany({
    where: { subscriptionId: { in: subscriptionIds } },
    orderBy: { sentAt: "desc" },
    select: { id: true, subscriptionId: true, sentAt: true, checkoutUrl: true }
  });
  const lastLinkBySub = new Map<string, { id: string; sentAt: Date; checkoutUrl: string }>();
  for (const link of latestLinks) {
    if (!lastLinkBySub.has(link.subscriptionId)) lastLinkBySub.set(link.subscriptionId, link);
  }

  const pendingRetries = subscriptionIds.length
    ? await prisma.retryJob.findMany({
        where: {
          type: RetryJobType.PAYMENT_RETRY,
          status: RetryJobStatus.PENDING,
          OR: subscriptionIds.map((id) => ({ payload: subscriptionIdJsonFilter(id) }))
        }
      })
    : [];
  const nextRetryBySub = new Map<string, { runAt: Date }>();
  for (const job of pendingRetries) {
    const payload = job.payload && typeof job.payload === "object" ? (job.payload as Record<string, unknown>) : {};
    const subId = String(payload.subscriptionId || "");
    if (!subId) continue;
    const current = nextRetryBySub.get(subId);
    if (!current || (job.runAt && current.runAt > job.runAt)) {
      nextRetryBySub.set(subId, { runAt: job.runAt });
    }
  }

  const autoDebitCfg = await getAutoDebitConfig();
  const configuredGraceDays = Number.isFinite(Number(autoDebitCfg?.graceDays))
    ? Math.max(1, Math.trunc(Number(autoDebitCfg?.graceDays)))
    : 5;
  const billingAsOf = getCivilDateAnchorUtc(new Date());
  const billingStateBySubscription = await buildSubscriptionBillingStateIndex({
    subscriptions: items.map((s) => ({
      id: s.id,
      startAt: s.startAt,
      cycleStartDay: s.cycleStartDay,
      paymentDay: s.paymentDay,
      paymentTiming: s.paymentTiming === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO",
      graceDays: configuredGraceDays,
      plan: {
        intervalUnit: s.plan.intervalUnit,
        intervalCount: s.plan.intervalCount
      }
    })),
    asOf: billingAsOf,
    ensureCycles: false
  });
  const mapped = items.map((s) => {
    const planRecord = s.plan as Record<string, unknown>;
    const planMetadata =
      s.plan?.metadata && typeof s.plan.metadata === "object" ? (s.plan.metadata as Record<string, unknown>) : {};
    const planCatalog =
      planMetadata.catalog && typeof planMetadata.catalog === "object"
        ? (planMetadata.catalog as Record<string, unknown>)
        : {};
    const lastPayment = lastPaymentBySub.get(String(s.id)) || null;
    const lastLink = lastLinkBySub.get(String(s.id)) || null;
    const nextRetry = nextRetryBySub.get(String(s.id)) || null;
    const resolvedMode = resolveSubscriptionCollectionMode(s);
    const customerTokenized = extractCustomerPaymentSourceId(s.customer?.metadata) !== null;
    const billingState = billingStateBySubscription.get(String(s.id)) || null;
    const activeCycle = billingState?.activeCycle || null;
    const paymentTiming = s.paymentTiming === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";
    const rawCollectionCycle = billingState?.collectionCycle || activeCycle;
    const collectionCycle =
      paymentTiming === "EN_CURSO" && isBillingCyclePaid(activeCycle)
        ? activeCycle
        : rawCollectionCycle;
    const periodStartAt = activeCycle?.periodStartAt ? new Date(activeCycle.periodStartAt) : null;
    const periodEndAt = activeCycle?.periodEndAt ? new Date(activeCycle.periodEndAt) : null;
    const collectionCyclePaid = isBillingCyclePaid(collectionCycle);
    const lastPaidInCurrentPeriod = collectionCyclePaid;
    const currentCycleApprovedPayment =
      collectionCycle && typeof collectionCycle.cycleNumber === "number"
        ? approvedPaymentByCycle.get(`${s.id}:${collectionCycle.cycleNumber}`) || null
        : null;
    const canManualUnmarkPaid = Boolean(lastPaidInCurrentPeriod && currentCycleApprovedPayment?.isManual);
    const dueAt = collectionCycle?.dueAt ? new Date(collectionCycle.dueAt) : periodEndAt;
    // La mora se mide por el ciclo más antiguo SIN pagar (que puede estar vencido),
    // no por el collectionCycle (que puede ser el ciclo en curso aún no vencido).
    // Si no hay ciclo viejo sin pagar, se cae al collectionCycle. Mismo criterio que
    // scripts/audit-subscription-states.ts.
    const delinquencyCycle =
      billingState?.oldestUnpaidCycle && !isBillingCyclePaid(billingState.oldestUnpaidCycle)
        ? billingState.oldestUnpaidCycle
        : collectionCycle;
    const delinquency = resolveCollectionDelinquency({
      cycle: delinquencyCycle,
      graceDays: configuredGraceDays,
      asOf: billingAsOf,
      fallbackSubscriptionStatus: s.status
    });
    const isInactiveStatus =
      s.status === SubscriptionStatus.CANCELED || s.status === SubscriptionStatus.EXPIRED || s.status === SubscriptionStatus.SUSPENDED;
    const effectiveStatus = isInactiveStatus
      ? s.status
      : delinquency.status === "EN_MORA"
        ? SubscriptionStatus.PAST_DUE
        : SubscriptionStatus.ACTIVE;
    // Use the oldest unresolved cycle shape exposed by ResolvedBillingState.
    const nextOpenCycle =
      collectionCycle && !isBillingCyclePaid(collectionCycle)
        ? collectionCycle
        : billingState?.oldestUnpaidCycle && !isBillingCyclePaid(billingState.oldestUnpaidCycle)
          ? billingState.oldestUnpaidCycle
          : null;
    const chargeDue = collectionCyclePaid ? false : dueAt ? dueAt.getTime() <= Date.now() + 5_000 : false;
    const isInactive =
      s.status === SubscriptionStatus.CANCELED || s.status === SubscriptionStatus.EXPIRED || s.status === SubscriptionStatus.SUSPENDED;
    const allowManualCharge = Boolean(autoDebitCfg?.allowManualCharge ?? true);
    const canManualCharge =
      allowManualCharge &&
      resolvedMode === "AUTO_DEBIT" &&
      !isInactive &&
      customerTokenized;
    const canManualMarkPaid =
      allowManualCharge &&
      !isInactive;
    const autoChargeEnabled = resolvedMode === "AUTO_DEBIT" ? Boolean(autoDebitCfg.enabled && autoDebitCfg.chargeAtCutoffEnabled) : false;
    const retryAutomationEnabled = resolvedMode === "AUTO_DEBIT" ? Boolean(autoDebitCfg.retryEnabled) : false;
    const effectiveRetryAt =
      nextRetry?.runAt ||
      (autoChargeEnabled && retryAutomationEnabled ? ((s.metadata as any)?.manualRetry?.nextRetryAt || (s.metadata as any)?.autoRetry?.nextRetryAt || null) : null);
    const nextChargeDate = nextOpenCycle?.dueAt ? new Date(nextOpenCycle.dueAt) : dueAt;

    return {
      ...s,
      status: effectiveStatus,
      persistedStatus: s.status,
      collectionStatus: delinquency.status,
      productId:
        s.productId ||
        String(planRecord.catalogProductId || planCatalog.itemId || "").trim() ||
        null,
      productName: s.product?.name || s.plan?.name || null,
      tenantIds: Array.from(new Set([s.tenantId, ...(s.tenantLinks || []).map((t) => t.tenantId)].filter(Boolean))) as string[],
      lastPayment,
      lastPaymentLink: lastLink || null,
      nextRetryJob: nextRetry || null,
      collectionModeResolved: resolvedMode,
      activeCycleNumber: activeCycle?.cycleNumber ?? null,
      activeCycleStartAt: periodStartAt,
      activeCycleEndAt: periodEndAt,
      collectionCycleNumber: collectionCycle?.cycleNumber ?? null,
      collectionCyclePaid,
      nextBillingDate: nextChargeDate,
      currentCollectionDueAt: dueAt,
      customerTokenized,
      chargeDue,
      canManualCharge,
      canManualMarkPaid,
      canManualUnmarkPaid,
      manualChargeEnabled: allowManualCharge,
      manualMarkPaidEnabled: allowManualCharge,
      lastPaidInCurrentPeriod,
      autoChargeEnabled,
      retryAutomationEnabled,
      nextRetryAtEffective: effectiveRetryAt || null,
      lastNotice: lastNoticeBySub.get(s.id) ?? null,
      graceDays: configuredGraceDays
    };
  });

  const filtered = shouldFilterByEffectiveStatus
    ? mapped.filter((item) => {
        if (estado === "mora") return item.status === SubscriptionStatus.PAST_DUE;
        if (estado === "si") return item.status === SubscriptionStatus.ACTIVE;
        return item.status !== SubscriptionStatus.ACTIVE && item.status !== SubscriptionStatus.PAST_DUE;
      })
    : mapped;

  return { items: filtered, total: shouldFilterByEffectiveStatus ? filtered.length : total };
}
