import { prisma } from "../db/prisma";
import { GamificationEntityType, PaymentStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import { logger } from "../lib/logger";
import {
  GAMIFICATION_LEVEL_NAMES,
  GAMIFICATION_LEVEL_THRESHOLDS,
  GAMIFICATION_WEIGHTS,
  GAMIFICATION_RECENCY,
  GAMIFICATION_PENALTIES,
  GAMIFICATION_CONSISTENCY,
  GAMIFICATION_DATA_QUALITY,
  GAMIFICATION_FACTORS_DEFAULT,
  levelForScore,
  moneyToPoints
} from "./gamificationConfig";
import { getGamificationConfig } from "./gamificationSettings";

export const GAMIFICATION_EVENT_KINDS = {
  PAYMENT_APPROVED: "payment.approved",
  PAYMENT_FAILED: "payment.failed",
  SUBSCRIPTION_STARTED: "subscription.started",
  SUBSCRIPTION_RENEWED: "subscription.renewed",
  SUBSCRIPTION_CANCELED: "subscription.canceled",
  SUBSCRIPTION_PAST_DUE: "subscription.past_due",
  CHATWOOT_MESSAGE_IN: "chatwoot.message_in",
  DATA_EMAIL_ADDED: "data.email_added",
  DATA_PHONE_ADDED: "data.phone_added",
  DATA_ID_ADDED: "data.id_added"
} as const;

export type GamificationEventInput = {
  entityType: GamificationEntityType;
  entityId: string;
  tenantId?: string | null;
  kind: string;
  moneyInCents?: number | null;
  statusDelta?: number;
  lifetimeDelta?: number;
  rewardDelta?: number;
  metadata?: Record<string, unknown> | null;
  includeGlobal?: boolean;
  occurredAt?: Date;
};

type GamificationWeights = typeof GAMIFICATION_WEIGHTS;
type GamificationWeightsOverride = { [K in keyof GamificationWeights]?: Partial<GamificationWeights[K]> };
type GamificationPenalties = typeof GAMIFICATION_PENALTIES;
type GamificationPenaltiesOverride = Partial<GamificationPenalties>;

type TenantGamificationMeta = {
  gamification?: {
    factor?: number;
    bonus?: number;
  };
};

type CustomerMeta = {
  chatwoot?: { lastEventAt?: string };
  address?: { line1?: string; city?: string; dept?: string };
  city?: string;
  dept?: string;
  identificacion?: string;
  identificacionNumero?: string;
  identificationNumber?: string;
  documentNumber?: string;
  document?: string;
  documento?: string;
};

function mergeWeights(overrides?: GamificationWeightsOverride | null) {
  const keys = Object.keys(GAMIFICATION_WEIGHTS) as Array<keyof GamificationWeights>;
  const out = Object.fromEntries(
    keys.map((key) => [key, { ...GAMIFICATION_WEIGHTS[key], ...(overrides?.[key] ?? {}) }])
  ) as GamificationWeights;
  return out;
}

function mergePenalties(overrides?: GamificationPenaltiesOverride | null) {
  return { ...GAMIFICATION_PENALTIES, ...(overrides ?? {}) } as GamificationPenalties;
}

function resolveEventDeltas(input: GamificationEventInput, weights = GAMIFICATION_WEIGHTS) {
  const kind = String(input.kind || "").trim();
  const moneyPts = moneyToPoints(input.moneyInCents || 0, weights.paymentApproved.moneyScale);

  if (kind === GAMIFICATION_EVENT_KINDS.PAYMENT_APPROVED) {
    return {
      statusDelta: (input.statusDelta ?? weights.paymentApproved.status) + moneyPts,
      lifetimeDelta: (input.lifetimeDelta ?? weights.paymentApproved.lifetime) + moneyPts,
      rewardDelta: input.rewardDelta ?? weights.paymentApproved.reward
    };
  }
  if (kind === GAMIFICATION_EVENT_KINDS.PAYMENT_FAILED) {
    return {
      statusDelta: input.statusDelta ?? weights.paymentFailed.status,
      lifetimeDelta: input.lifetimeDelta ?? weights.paymentFailed.lifetime,
      rewardDelta: input.rewardDelta ?? weights.paymentFailed.reward
    };
  }
  if (kind === GAMIFICATION_EVENT_KINDS.SUBSCRIPTION_STARTED) {
    return {
      statusDelta: input.statusDelta ?? weights.subscriptionStarted.status,
      lifetimeDelta: input.lifetimeDelta ?? weights.subscriptionStarted.lifetime,
      rewardDelta: input.rewardDelta ?? weights.subscriptionStarted.reward
    };
  }
  if (kind === GAMIFICATION_EVENT_KINDS.SUBSCRIPTION_RENEWED) {
    return {
      statusDelta: input.statusDelta ?? weights.subscriptionRenewed.status,
      lifetimeDelta: input.lifetimeDelta ?? weights.subscriptionRenewed.lifetime,
      rewardDelta: input.rewardDelta ?? weights.subscriptionRenewed.reward
    };
  }
  if (kind === GAMIFICATION_EVENT_KINDS.SUBSCRIPTION_CANCELED) {
    return {
      statusDelta: input.statusDelta ?? weights.subscriptionCanceled.status,
      lifetimeDelta: input.lifetimeDelta ?? weights.subscriptionCanceled.lifetime,
      rewardDelta: input.rewardDelta ?? weights.subscriptionCanceled.reward
    };
  }
  if (kind === GAMIFICATION_EVENT_KINDS.SUBSCRIPTION_PAST_DUE) {
    return {
      statusDelta: input.statusDelta ?? weights.subscriptionPastDue.status,
      lifetimeDelta: input.lifetimeDelta ?? weights.subscriptionPastDue.lifetime,
      rewardDelta: input.rewardDelta ?? weights.subscriptionPastDue.reward
    };
  }
  if (kind === GAMIFICATION_EVENT_KINDS.CHATWOOT_MESSAGE_IN) {
    return {
      statusDelta: input.statusDelta ?? weights.chatwootMessageIn.status,
      lifetimeDelta: input.lifetimeDelta ?? weights.chatwootMessageIn.lifetime,
      rewardDelta: input.rewardDelta ?? weights.chatwootMessageIn.reward
    };
  }
  if (kind === GAMIFICATION_EVENT_KINDS.DATA_EMAIL_ADDED) {
    return {
      statusDelta: input.statusDelta ?? weights.dataEmailAdded.status,
      lifetimeDelta: input.lifetimeDelta ?? weights.dataEmailAdded.lifetime,
      rewardDelta: input.rewardDelta ?? weights.dataEmailAdded.reward
    };
  }
  if (kind === GAMIFICATION_EVENT_KINDS.DATA_PHONE_ADDED) {
    return {
      statusDelta: input.statusDelta ?? weights.dataPhoneAdded.status,
      lifetimeDelta: input.lifetimeDelta ?? weights.dataPhoneAdded.lifetime,
      rewardDelta: input.rewardDelta ?? weights.dataPhoneAdded.reward
    };
  }
  if (kind === GAMIFICATION_EVENT_KINDS.DATA_ID_ADDED) {
    return {
      statusDelta: input.statusDelta ?? weights.dataIdAdded.status,
      lifetimeDelta: input.lifetimeDelta ?? weights.dataIdAdded.lifetime,
      rewardDelta: input.rewardDelta ?? weights.dataIdAdded.reward
    };
  }

  return {
    statusDelta: input.statusDelta ?? 0,
    lifetimeDelta: input.lifetimeDelta ?? 0,
    rewardDelta: input.rewardDelta ?? 0
  };
}

async function getTenantGamificationConfig(tenantId?: string | null) {
  if (!tenantId) return { ...GAMIFICATION_FACTORS_DEFAULT };
  const tenant = await prisma.saTenant.findUnique({ where: { id: tenantId }, select: { metadata: true } });
  const meta = (tenant?.metadata ?? {}) as TenantGamificationMeta;
  const cfg = meta?.gamification || {};
  const factorRaw = Number(cfg?.factor ?? GAMIFICATION_FACTORS_DEFAULT.factor);
  const bonusRaw = Number(cfg?.bonus ?? GAMIFICATION_FACTORS_DEFAULT.bonus);
  const factor = Number.isFinite(factorRaw) && factorRaw > 0 ? factorRaw : GAMIFICATION_FACTORS_DEFAULT.factor;
  const bonus = Number.isFinite(bonusRaw) ? bonusRaw : GAMIFICATION_FACTORS_DEFAULT.bonus;
  return { factor, bonus };
}

function computeEffectiveScore(globalScore: number, tenantScore: number, factor: number, bonus: number) {
  const g = Number(globalScore || 0);
  const t = Number(tenantScore || 0);
  return g * factor + t + bonus;
}

async function updateLevelForScoreRow(rowId: string, score: number) {
  const { level } = levelForScore(score);
  await prisma.gamificationScore.update({ where: { id: rowId }, data: { level } }).catch((err) => {
    logger.warn({ err, rowId, score }, '[Gamification] Fallo actualizando level');
  });
}

async function upsertScoreRow(args: {
  tenantId: string | null;
  entityType: GamificationEntityType;
  entityId: string;
  create: any;
  update: any;
}) {
  if (args.tenantId == null) {
    const existing = await prisma.gamificationScore.findFirst({
      where: { tenantId: null, entityType: args.entityType, entityId: args.entityId }
    });
    if (existing) {
      return prisma.gamificationScore.update({ where: { id: existing.id }, data: args.update });
    }
    return prisma.gamificationScore.create({ data: args.create });
  }
  return prisma.gamificationScore.upsert({
    where: {
      tenantId_entityType_entityId: {
        tenantId: args.tenantId,
        entityType: args.entityType,
        entityId: args.entityId
      }
    },
    create: args.create,
    update: args.update
  });
}

async function writeRewardLedger(customerId: string, tenantId: string | null, rewardDelta: number, eventId?: string | null) {
  if (!rewardDelta) return;
  const last = await prisma.gamificationRewardLedger.findFirst({
    where: { customerId, tenantId: tenantId || null },
    orderBy: { createdAt: "desc" }
  });
  const balance = Math.max(0, Number(last?.balance || 0) + rewardDelta);
  await prisma.gamificationRewardLedger
    .create({
      data: {
        customerId,
        tenantId: tenantId || null,
        eventId: eventId || null,
        pointsEarned: rewardDelta > 0 ? rewardDelta : 0,
        pointsRedeemed: rewardDelta < 0 ? Math.abs(rewardDelta) : 0,
        balance
      }
    })
    .catch((err) => {
      logger.warn({ err, customerId }, '[Gamification] Fallo creando reward ledger');
    });
}

export async function applyGamificationEvent(input: GamificationEventInput) {
  const now = input.occurredAt ?? new Date();
  const includeGlobal = input.includeGlobal !== false;
  const tenantId = input.tenantId || null;
  const cfg = await getGamificationConfig().catch(() => null);
  const weights = mergeWeights(cfg?.weights);
  const deltas = resolveEventDeltas(input, weights);

  const targets: Array<{ tenantId: string | null; isGlobal: boolean }> = [];
  if (tenantId) targets.push({ tenantId, isGlobal: false });
  if (includeGlobal) targets.push({ tenantId: null, isGlobal: true });

  const updatedRows: Array<{ id: string; tenantId: string | null; statusScore: number }> = [];

  for (const target of targets) {
    const event = await prisma.gamificationEvent.create({
      data: {
        ...(target.tenantId ? { tenantId: target.tenantId } : {}),
        entityType: input.entityType,
        entityId: input.entityId,
        kind: String(input.kind || "").trim() || "custom",
        statusDelta: deltas.statusDelta,
        lifetimeDelta: deltas.lifetimeDelta,
        rewardDelta: deltas.rewardDelta,
        moneyInCents: input.moneyInCents ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        createdAt: now
      }
    });

    const isPayment = String(input.kind || "").startsWith("payment.");
    const isActivity = isPayment || String(input.kind || "").startsWith("chatwoot.") || String(input.kind || "").startsWith("data.");

    const scoreRow = await upsertScoreRow({
      tenantId: target.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      create: {
        ...(target.tenantId ? { tenantId: target.tenantId } : {}),
        entityType: input.entityType,
        entityId: input.entityId,
        lifetimePoints: Math.max(0, deltas.lifetimeDelta),
        statusScore: deltas.statusDelta,
        level: 1,
        lastActivityAt: isActivity ? now : null,
        lastPaymentAt: isPayment ? now : null,
        createdAt: now,
        updatedAt: now
      },
      update: {
        lifetimePoints: { increment: deltas.lifetimeDelta },
        statusScore: { increment: deltas.statusDelta },
        ...(isActivity ? { lastActivityAt: now } : {}),
        ...(isPayment ? { lastPaymentAt: now } : {})
      }
    });

    updatedRows.push({ id: scoreRow.id, tenantId: target.tenantId, statusScore: scoreRow.statusScore });

    if (!target.isGlobal && input.entityType === GamificationEntityType.CUSTOMER) {
      await writeRewardLedger(input.entityId, target.tenantId, deltas.rewardDelta, event.id);
    }
  }

  const globalRow = updatedRows.find((r) => r.tenantId === null);

  for (const row of updatedRows) {
    if (row.tenantId == null) {
      await updateLevelForScoreRow(row.id, row.statusScore);
      continue;
    }

    const cfg = await getTenantGamificationConfig(row.tenantId);
    const effectiveScore = computeEffectiveScore(globalRow?.statusScore || 0, row.statusScore, cfg.factor, cfg.bonus);
    await updateLevelForScoreRow(row.id, effectiveScore);
  }
}

function parseIso(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function computeRecencyScore(lastPaymentAt?: Date | null, lastActivityAt?: Date | null) {
  const now = Date.now();
  let score = 0;

  const addIfWithin = (ts: Date | null | undefined, ms: number, pts: number) => {
    if (!ts) return;
    if (now - ts.getTime() <= ms) score += pts;
  };

  addIfWithin(lastPaymentAt, 24 * 60 * 60 * 1000, GAMIFICATION_RECENCY.payment24h);
  addIfWithin(lastPaymentAt, 7 * 24 * 60 * 60 * 1000, GAMIFICATION_RECENCY.payment7d);
  addIfWithin(lastPaymentAt, 30 * 24 * 60 * 60 * 1000, GAMIFICATION_RECENCY.payment30d);

  addIfWithin(lastActivityAt, 24 * 60 * 60 * 1000, GAMIFICATION_RECENCY.activity24h);
  addIfWithin(lastActivityAt, 7 * 24 * 60 * 60 * 1000, GAMIFICATION_RECENCY.activity7d);
  addIfWithin(lastActivityAt, 30 * 24 * 60 * 60 * 1000, GAMIFICATION_RECENCY.activity30d);

  return score;
}

function computeDataQualityScore(customer: { email?: string | null; phone?: string | null; metadata?: CustomerMeta | null }) {
  const email = String(customer?.email || "").trim();
  const phone = String(customer?.phone || "").trim();
  const meta = customer?.metadata || {};
  const idValue =
    meta?.identificacion ||
    meta?.identificacionNumero ||
    meta?.identificationNumber ||
    meta?.documentNumber ||
    meta?.document ||
    meta?.documento ||
    null;
  const address = meta?.address?.line1 || meta?.address?.city || meta?.address?.dept || meta?.city || meta?.dept || null;

  let score = 0;
  if (email) score += GAMIFICATION_DATA_QUALITY.email;
  if (phone) score += GAMIFICATION_DATA_QUALITY.phone;
  if (idValue) score += GAMIFICATION_DATA_QUALITY.id;
  if (address) score += GAMIFICATION_DATA_QUALITY.address;
  return score;
}

function computeCustomerScores(args: {
  approvedCount: number;
  totalAmountInCents: number;
  lastPaidAt?: Date | null;
  lastActivityAt?: Date | null;
  subscriptionStatus?: SubscriptionStatus | null;
  daysPastDue?: number;
  dataQualityScore: number;
  decay: { inactivityDays: number; perDay: number; maxPenalty: number };
  weights: typeof GAMIFICATION_WEIGHTS;
  penalties: typeof GAMIFICATION_PENALTIES;
}) {
  const approvedCount = Math.max(0, args.approvedCount || 0);
  const totalAmountInCents = Math.max(0, args.totalAmountInCents || 0);
  const monetaryScore = approvedCount * args.weights.paymentApproved.status + moneyToPoints(totalAmountInCents, args.weights.paymentApproved.moneyScale);
  const consistencyScore = Math.min(approvedCount, GAMIFICATION_CONSISTENCY.maxMonths) * GAMIFICATION_CONSISTENCY.perPayment;
  const recencyScore = computeRecencyScore(args.lastPaidAt, args.lastActivityAt);
  const activityScore = args.lastActivityAt ? Math.round(recencyScore * 0.4) : 0;

  let penaltyScore = 0;
  if (args.subscriptionStatus === SubscriptionStatus.PAST_DUE) penaltyScore += args.penalties.pastDue;
  if (args.subscriptionStatus === SubscriptionStatus.CANCELED) penaltyScore += args.penalties.canceled;
  if ((args.daysPastDue || 0) > 0) penaltyScore += Math.min(120, (args.daysPastDue || 0) * 3);
  if (args.lastActivityAt) {
    const daysSince = Math.floor((Date.now() - args.lastActivityAt.getTime()) / 86_400_000);
    if (daysSince > args.decay.inactivityDays) {
      const extra = Math.min(
        args.decay.maxPenalty,
        (daysSince - args.decay.inactivityDays) * args.decay.perDay
      );
      penaltyScore += extra;
    }
  } else {
    penaltyScore += args.decay.maxPenalty;
  }

  const statusScore = Math.max(0, monetaryScore + consistencyScore + recencyScore + activityScore + args.dataQualityScore - penaltyScore);
  const lifetimePoints = Math.max(0, approvedCount * args.weights.paymentApproved.lifetime + moneyToPoints(totalAmountInCents, args.weights.paymentApproved.moneyScale) + args.dataQualityScore);

  return {
    monetaryScore,
    consistencyScore,
    recencyScore,
    activityScore,
    penaltyScore,
    statusScore,
    lifetimePoints,
    streakMonths: Math.min(approvedCount, GAMIFICATION_CONSISTENCY.maxMonths)
  };
}

function computeProductScores(args: { approvedCount: number; totalAmountInCents: number; lastPaidAt?: Date | null; weights: typeof GAMIFICATION_WEIGHTS }) {
  const approvedCount = Math.max(0, args.approvedCount || 0);
  const totalAmountInCents = Math.max(0, args.totalAmountInCents || 0);
  const monetaryScore = approvedCount * args.weights.paymentApproved.status + moneyToPoints(totalAmountInCents, args.weights.paymentApproved.moneyScale);
  const recencyScore = computeRecencyScore(args.lastPaidAt, args.lastPaidAt);
  const statusScore = Math.max(0, monetaryScore + recencyScore);
  const lifetimePoints = Math.max(0, approvedCount * args.weights.paymentApproved.lifetime + moneyToPoints(totalAmountInCents, args.weights.paymentApproved.moneyScale));
  return { monetaryScore, recencyScore, statusScore, lifetimePoints };
}

export async function recomputeGamificationScores(opts?: { scope?: "customers" | "products" | "all"; tenantId?: string | null }) {
  const scope = opts?.scope || "all";
  const cfg = await getGamificationConfig();
  const weights = mergeWeights(cfg?.weights);
  const penalties = mergePenalties(cfg?.penalties);
  if (scope === "customers" || scope === "all") {
    await recomputeCustomerScores(opts?.tenantId ?? null, cfg, weights, penalties);
  }
  if (scope === "products" || scope === "all") {
    await recomputeProductScores(opts?.tenantId ?? null, weights);
  }
}

async function recomputeCustomerScores(
  tenantId: string | null,
  cfg: { decay: { inactivityDays: number; perDay: number; maxPenalty: number } },
  weights: typeof GAMIFICATION_WEIGHTS,
  penalties: typeof GAMIFICATION_PENALTIES
) {
  const customerWhere: any = tenantId
    ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] }
    : {};

  const customers = await prisma.customer.findMany({
    where: customerWhere,
    select: { id: true, tenantId: true, email: true, phone: true, metadata: true, tenantLinks: { select: { tenantId: true } } }
  });

  const approvedAgg = await prisma.payment.groupBy({
    by: ["customerId", "tenantId"],
    where: {
      status: PaymentStatus.APPROVED,
      ...(tenantId ? { tenantId } : {})
    },
    _count: { _all: true },
    _sum: { amountInCents: true },
    _max: { paidAt: true }
  });

  const approvedGlobalAgg = await prisma.payment.groupBy({
    by: ["customerId"],
    where: { status: PaymentStatus.APPROVED },
    _count: { _all: true },
    _sum: { amountInCents: true },
    _max: { paidAt: true }
  });

  const subWhere: any = tenantId ? { tenantId } : {};
  const subscriptions = await prisma.subscription.findMany({
    where: subWhere,
    select: { customerId: true, tenantId: true, status: true, currentPeriodEndAt: true, createdAt: true },
    orderBy: { createdAt: "desc" }
  });

  const subByKey = new Map<string, any>();
  for (const sub of subscriptions) {
    const key = `${sub.tenantId || ""}:${sub.customerId}`;
    if (!subByKey.has(key)) subByKey.set(key, sub);
  }

  const globalSubByCustomer = new Map<string, any>();
  for (const sub of subscriptions) {
    const key = String(sub.customerId);
    if (!globalSubByCustomer.has(key)) globalSubByCustomer.set(key, sub);
  }

  const approvedByTenantCustomer = new Map<string, { count: number; amount: number; lastPaidAt?: Date | null }>();
  approvedAgg.forEach((row) => {
    const key = `${row.tenantId || ""}:${row.customerId}`;
    approvedByTenantCustomer.set(key, {
      count: Number(row._count?._all || 0),
      amount: Number(row._sum?.amountInCents || 0),
      lastPaidAt: row._max?.paidAt ? new Date(row._max.paidAt as any) : null
    });
  });

  const approvedByCustomer = new Map<string, { count: number; amount: number; lastPaidAt?: Date | null }>();
  approvedGlobalAgg.forEach((row) => {
    const key = String(row.customerId);
    approvedByCustomer.set(key, {
      count: Number(row._count?._all || 0),
      amount: Number(row._sum?.amountInCents || 0),
      lastPaidAt: row._max?.paidAt ? new Date(row._max.paidAt as any) : null
    });
  });

  const globalScoreByCustomer = new Map<string, { score: number; rowId: string }>();

  for (const customer of customers) {
    const globalStats = approvedByCustomer.get(String(customer.id)) || { count: 0, amount: 0, lastPaidAt: null };
    const customerMeta = (customer?.metadata ?? {}) as CustomerMeta;
    const chatwootAt = parseIso(customerMeta?.chatwoot?.lastEventAt) || null;
    const lastActivityAt = [globalStats.lastPaidAt, chatwootAt].filter(Boolean).sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0] || null;
    const dataQualityScore = computeDataQualityScore({
      email: customer.email,
      phone: customer.phone,
      metadata: (customer.metadata ?? null) as CustomerMeta | null
    });
    const sub = globalSubByCustomer.get(String(customer.id)) || null;
    const currentPeriodEndAt = sub?.currentPeriodEndAt ? new Date(sub.currentPeriodEndAt) : null;
    const daysPastDue = currentPeriodEndAt && currentPeriodEndAt.getTime() < Date.now()
      ? Math.floor((Date.now() - currentPeriodEndAt.getTime()) / 86_400_000)
      : 0;

    const computed = computeCustomerScores({
      approvedCount: globalStats.count,
      totalAmountInCents: globalStats.amount,
      lastPaidAt: globalStats.lastPaidAt,
      lastActivityAt,
      subscriptionStatus: sub?.status || null,
      daysPastDue,
      dataQualityScore,
      decay: cfg.decay,
      weights,
      penalties
    });

    const levelInfo = levelForScore(computed.statusScore);

    const row = await upsertScoreRow({
      tenantId: null,
      entityType: GamificationEntityType.CUSTOMER,
      entityId: customer.id,
      create: {
        entityType: GamificationEntityType.CUSTOMER,
        entityId: customer.id,
        lifetimePoints: computed.lifetimePoints,
        statusScore: computed.statusScore,
        level: levelInfo.level,
        lastActivityAt,
        lastPaymentAt: globalStats.lastPaidAt,
        streakMonths: computed.streakMonths,
        dataQualityScore,
        recencyScore: computed.recencyScore,
        monetaryScore: computed.monetaryScore,
        activityScore: computed.activityScore,
        consistencyScore: computed.consistencyScore,
        penaltyScore: computed.penaltyScore
      },
      update: {
        lifetimePoints: computed.lifetimePoints,
        statusScore: computed.statusScore,
        level: levelInfo.level,
        lastActivityAt,
        lastPaymentAt: globalStats.lastPaidAt,
        streakMonths: computed.streakMonths,
        dataQualityScore,
        recencyScore: computed.recencyScore,
        monetaryScore: computed.monetaryScore,
        activityScore: computed.activityScore,
        consistencyScore: computed.consistencyScore,
        penaltyScore: computed.penaltyScore
      }
    });

    globalScoreByCustomer.set(String(customer.id), { score: computed.statusScore, rowId: row.id });
  }

  for (const customer of customers) {
    const rawTenantIds = tenantId
      ? [tenantId]
      : [customer.tenantId, ...(customer?.tenantLinks?.map?.((t: any) => t.tenantId) || [])];
    const tenantIdList = Array.from(
      new Set(rawTenantIds.filter((id): id is string => typeof id === "string" && id.length > 0))
    );

    for (const tId of tenantIdList) {
      if (!tId) continue;
      const stats = approvedByTenantCustomer.get(`${tId}:${customer.id}`) || { count: 0, amount: 0, lastPaidAt: null };
    const customerMeta = (customer?.metadata ?? {}) as CustomerMeta;
    const chatwootAt = parseIso(customerMeta?.chatwoot?.lastEventAt) || null;
      const lastActivityAt = [stats.lastPaidAt, chatwootAt].filter(Boolean).sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0] || null;
      const dataQualityScore = computeDataQualityScore({
        email: customer.email,
        phone: customer.phone,
        metadata: (customer.metadata ?? null) as CustomerMeta | null
      });
      const sub = subByKey.get(`${tId}:${customer.id}`) || null;
      const currentPeriodEndAt = sub?.currentPeriodEndAt ? new Date(sub.currentPeriodEndAt) : null;
      const daysPastDue = currentPeriodEndAt && currentPeriodEndAt.getTime() < Date.now()
        ? Math.floor((Date.now() - currentPeriodEndAt.getTime()) / 86_400_000)
        : 0;

      const computed = computeCustomerScores({
        approvedCount: stats.count,
        totalAmountInCents: stats.amount,
        lastPaidAt: stats.lastPaidAt,
        lastActivityAt,
        subscriptionStatus: sub?.status || null,
        daysPastDue,
        dataQualityScore,
        decay: cfg.decay,
        weights,
        penalties
      });

      const globalScore = globalScoreByCustomer.get(String(customer.id))?.score || 0;
      const tenantCfg = await getTenantGamificationConfig(tId);
      const effectiveScore = computeEffectiveScore(globalScore, computed.statusScore, tenantCfg.factor, tenantCfg.bonus);
      const levelInfo = levelForScore(effectiveScore);

      await prisma.gamificationScore.upsert({
        where: {
          tenantId_entityType_entityId: {
            tenantId: tId,
            entityType: GamificationEntityType.CUSTOMER,
            entityId: customer.id
          }
        },
        create: {
          tenantId: tId,
          entityType: GamificationEntityType.CUSTOMER,
          entityId: customer.id,
          lifetimePoints: computed.lifetimePoints,
          statusScore: computed.statusScore,
          level: levelInfo.level,
          lastActivityAt,
          lastPaymentAt: stats.lastPaidAt,
          streakMonths: computed.streakMonths,
          dataQualityScore,
          recencyScore: computed.recencyScore,
          monetaryScore: computed.monetaryScore,
          activityScore: computed.activityScore,
          consistencyScore: computed.consistencyScore,
          penaltyScore: computed.penaltyScore
        },
        update: {
          lifetimePoints: computed.lifetimePoints,
          statusScore: computed.statusScore,
          level: levelInfo.level,
          lastActivityAt,
          lastPaymentAt: stats.lastPaidAt,
          streakMonths: computed.streakMonths,
          dataQualityScore,
          recencyScore: computed.recencyScore,
          monetaryScore: computed.monetaryScore,
          activityScore: computed.activityScore,
          consistencyScore: computed.consistencyScore,
          penaltyScore: computed.penaltyScore
        }
      });
    }
  }
}

async function recomputeProductScores(tenantId: string | null, weights: typeof GAMIFICATION_WEIGHTS) {
  const planWhere: any = {
    metadata: { path: ["kind"], equals: "CATALOG_ITEM" } as any,
    ...(tenantId ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] } : {})
  };

  const plans = await prisma.subscriptionPlan.findMany({
    where: planWhere,
    select: { id: true, tenantId: true }
  });

  if (!plans.length) return;

  const planIds = plans.map((p) => p.id);

  const tenantFilter = tenantId ? `AND s."tenantId" = '${tenantId}'::uuid` : "";
  const rows = await prisma.$queryRawUnsafe<
    Array<{ planId: string; tenantId: string; approvedCount: bigint; amountInCents: bigint; lastPaidAt: Date | null }>
  >(
    `SELECT s."planId" as "planId",
            s."tenantId" as "tenantId",
            COUNT(p.*)::bigint as "approvedCount",
            COALESCE(SUM(p."amountInCents"), 0)::bigint as "amountInCents",
            MAX(p."paidAt") as "lastPaidAt"
     FROM "Payment" p
     JOIN "Subscription" s ON s."id" = p."subscriptionId"
     WHERE p."status" = 'APPROVED'
       AND p."subscriptionId" IS NOT NULL
       AND s."planId" IN (${planIds.map((id) => `'${id}'::uuid`).join(",")})
       ${tenantFilter}
     GROUP BY 1, 2`
  );

  const rowsByKey = new Map<string, { count: number; amount: number; lastPaidAt: Date | null }>();
  rows.forEach((r) => {
    const key = `${r.tenantId || ""}:${r.planId}`;
    rowsByKey.set(key, {
      count: Number(r.approvedCount || 0),
      amount: Number(r.amountInCents || 0),
      lastPaidAt: r.lastPaidAt ? new Date(r.lastPaidAt) : null
    });
  });

  const globalRows = await prisma.$queryRawUnsafe<
    Array<{ planId: string; approvedCount: bigint; amountInCents: bigint; lastPaidAt: Date | null }>
  >(
    `SELECT s."planId" as "planId",
            COUNT(p.*)::bigint as "approvedCount",
            COALESCE(SUM(p."amountInCents"), 0)::bigint as "amountInCents",
            MAX(p."paidAt") as "lastPaidAt"
     FROM "Payment" p
     JOIN "Subscription" s ON s."id" = p."subscriptionId"
     WHERE p."status" = 'APPROVED'
       AND p."subscriptionId" IS NOT NULL
       AND s."planId" IN (${planIds.map((id) => `'${id}'::uuid`).join(",")})
     GROUP BY 1`
  );

  const globalByPlan = new Map<string, { count: number; amount: number; lastPaidAt: Date | null }>();
  globalRows.forEach((r) => {
    globalByPlan.set(String(r.planId), {
      count: Number(r.approvedCount || 0),
      amount: Number(r.amountInCents || 0),
      lastPaidAt: r.lastPaidAt ? new Date(r.lastPaidAt) : null
    });
  });

  const globalScoreByPlan = new Map<string, number>();

  for (const plan of plans) {
    const stats = globalByPlan.get(String(plan.id)) || { count: 0, amount: 0, lastPaidAt: null };
    const computed = computeProductScores({
      approvedCount: stats.count,
      totalAmountInCents: stats.amount,
      lastPaidAt: stats.lastPaidAt,
      weights
    });
    const levelInfo = levelForScore(computed.statusScore);

    await upsertScoreRow({
      tenantId: null,
      entityType: GamificationEntityType.PRODUCT,
      entityId: plan.id,
      create: {
        entityType: GamificationEntityType.PRODUCT,
        entityId: plan.id,
        lifetimePoints: computed.lifetimePoints,
        statusScore: computed.statusScore,
        level: levelInfo.level,
        lastActivityAt: stats.lastPaidAt,
        lastPaymentAt: stats.lastPaidAt,
        monetaryScore: computed.monetaryScore,
        recencyScore: computed.recencyScore
      },
      update: {
        lifetimePoints: computed.lifetimePoints,
        statusScore: computed.statusScore,
        level: levelInfo.level,
        lastActivityAt: stats.lastPaidAt,
        lastPaymentAt: stats.lastPaidAt,
        monetaryScore: computed.monetaryScore,
        recencyScore: computed.recencyScore
      }
    });

    globalScoreByPlan.set(String(plan.id), computed.statusScore);
  }

  for (const plan of plans) {
    const tId = plan.tenantId || null;
    if (!tId) continue;
    const stats = rowsByKey.get(`${tId}:${plan.id}`) || { count: 0, amount: 0, lastPaidAt: null };
    const computed = computeProductScores({
      approvedCount: stats.count,
      totalAmountInCents: stats.amount,
      lastPaidAt: stats.lastPaidAt,
      weights
    });

    const globalScore = globalScoreByPlan.get(String(plan.id)) || 0;
    const cfg = await getTenantGamificationConfig(tId);
    const effectiveScore = computeEffectiveScore(globalScore, computed.statusScore, cfg.factor, cfg.bonus);
    const levelInfo = levelForScore(effectiveScore);

    await prisma.gamificationScore.upsert({
      where: {
        tenantId_entityType_entityId: {
          tenantId: tId,
          entityType: GamificationEntityType.PRODUCT,
          entityId: plan.id
        }
      },
      create: {
        tenantId: tId,
        entityType: GamificationEntityType.PRODUCT,
        entityId: plan.id,
        lifetimePoints: computed.lifetimePoints,
        statusScore: computed.statusScore,
        level: levelInfo.level,
        lastActivityAt: stats.lastPaidAt,
        lastPaymentAt: stats.lastPaidAt,
        monetaryScore: computed.monetaryScore,
        recencyScore: computed.recencyScore
      },
      update: {
        lifetimePoints: computed.lifetimePoints,
        statusScore: computed.statusScore,
        level: levelInfo.level,
        lastActivityAt: stats.lastPaidAt,
        lastPaymentAt: stats.lastPaidAt,
        monetaryScore: computed.monetaryScore,
        recencyScore: computed.recencyScore
      }
    });
  }
}

export function formatLevelName(level: number) {
  const idx = Math.max(1, Math.min(GAMIFICATION_LEVEL_NAMES.length, Math.round(level))) - 1;
  return GAMIFICATION_LEVEL_NAMES[idx] || GAMIFICATION_LEVEL_NAMES[0];
}

export function getLevelThresholds() {
  return GAMIFICATION_LEVEL_THRESHOLDS.slice();
}
