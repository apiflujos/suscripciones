import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { PaymentStatus, PlanType, SubscriptionStatus, PlanIntervalUnit, Prisma } from "@prisma/client";
import { buildSubscriptionBillingStateIndex, resolveCollectionDelinquency } from "./billingCycles";
import { getPaymentsConfig } from "./runtimeConfig";

type Granularity = "day" | "week" | "month";

type BucketRow = { bucket: Date };

type UnlinkedPaymentsRow = {
  payments_approved: number | bigint;
  payments_other: number | bigint;
  revenue_cents: number | bigint;
};

type PlatformBreakdownRow = {
  source: string;
  payments_success: number | bigint;
  payments_failed: number | bigint;
  revenue_cents: number | bigint;
};
type PaymentsByPlanTypeRow = {
  plan_type: PlanType;
  payments_success: number | bigint;
  payments_failed: number | bigint;
  revenue_cents: number | bigint;
};

type SeriesPoint = {
  at: string;
  revenueInCents: number;
  paymentsSuccess: number;
  paymentsFailed: number;
  linksSent: number;
  linksPaid: number;
  activeSubscriptions: number;
  mrrInCents?: number;
  newAutoSubscriptions?: number;
  canceledAutoSubscriptions?: number;
  churnMonthlyPct?: number | null;
};

// ============================================================================
// CONFIGURACIÓN Y UTILIDADES
// ============================================================================

function granularityConfig(g: Granularity) {
  if (g === "day") return { trunc: "day", step: "1 day" } as const;
  if (g === "week") return { trunc: "week", step: "1 week" } as const;
  return { trunc: "month", step: "1 month" } as const;
}

function clampRange(from: Date, to: Date) {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
    const toSafe = new Date();
    const fromSafe = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return { from: fromSafe, to: toSafe };
  }
  if (t <= f) {
    const toSafe = new Date(f.getTime() + 24 * 60 * 60 * 1000);
    return { from: f, to: toSafe };
  }
  return { from: f, to: t };
}

function iso(d: Date) {
  return d.toISOString();
}

function bucketKey(raw: any): string | null {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return iso(d);
}

function num(v: any) {
  const n = typeof v === "bigint" ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED];

function monthBoundsUtc(d: Date) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0) );
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0) );
  return { start, end };
}

function truncateUtc(d: Date, g: Granularity) {
  if (g === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
  if (g === "week") {
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const diff = (day + 6) % 7; // Monday=0
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff, 0, 0, 0));
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}

function addStepUtc(d: Date, g: Granularity) {
  if (g === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0));
  const stepDays = g === "week" ? 7 : 1;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + stepDays, 0, 0, 0));
}

function buildBucketsFallback(from: Date, to: Date, g: Granularity): BucketRow[] {
  const out: BucketRow[] = [];
  let cursor = truncateUtc(from, g);
  const end = truncateUtc(to, g);
  const maxIters = 4000;
  let i = 0;
  while (cursor <= end && i < maxIters) {
    out.push({ bucket: new Date(cursor) });
    cursor = addStepUtc(cursor, g);
    i += 1;
  }
  return out;
}

// ============================================================================
// SEGURIDAD: Validación de aliases para SQL (previene SQL Injection)
// ============================================================================

const VALID_SQL_ALIASES = ['p', 'pl', 's', 'sp', 'w', 'j', 'l', 'm', 'c'] as const;
type ValidAlias = typeof VALID_SQL_ALIASES[number];

/**
 * Valida que un alias sea seguro para usar en queries SQL
 * @param alias - El alias a validar
 * @returns El alias validado como tipo seguro
 * @throws Error si el alias no es válido
 */
function validateAlias(alias: string): ValidAlias {
  if (!VALID_SQL_ALIASES.includes(alias as ValidAlias)) {
    throw new Error(`[Security] Invalid SQL alias: ${alias}. Allowed: ${VALID_SQL_ALIASES.join(', ')}`);
  }
  return alias as ValidAlias;
}

/**
 * Genera un filtro WHERE seguro para tenantId
 * @param alias - Alias de la tabla (validado)
 * @param idx - Índice del parámetro SQL
 * @param hasTenant - Si hay tenant que filtrar
 * @returns Cláusula WHERE o string vacío
 */
function tenantFilter(alias: string, idx: number, hasTenant: boolean): string {
  // Validar alias para prevenir SQL injection
  validateAlias(alias);
  // Cuando no hay tenant, filtramos por tenantId IS NOT NULL para evitar errores de parámetros
  return hasTenant ? ` AND "${alias}"."tenantId" = $${idx}::uuid` : ` AND "${alias}"."tenantId" IS NOT NULL`;
}

/**
 * Factory para crear filtros tenantFilter pre-bindados con hasTenant
 * @param hasTenant - Si hay tenant que filtrar
 * @returns Función tenantFilter que solo requiere alias e idx
 */
function createTenantFilter(hasTenant: boolean) {
  return (alias: string, idx: number) => tenantFilter(alias, idx, hasTenant);
}

function tenantSql(alias: string, hasTenant: boolean, tenantId: string): Prisma.Sql {
  validateAlias(alias);
  return hasTenant
    ? Prisma.sql`AND ${Prisma.raw(`"${alias}"."tenantId"`)} = ${tenantId}::uuid`
    : Prisma.raw(`AND "${alias}"."tenantId" IS NOT NULL`);
}

function paymentReconciliationSql(alias: string): Prisma.Sql {
  validateAlias(alias);
  return Prisma.raw(
    `AND COALESCE(("${alias}"."providerResponse"->'reconciliation'->>'status')::text, '') <> 'IGNORED_EXTERNAL'`
  );
}

function paymentUnlinkedSql(alias: string, includeUnlinkedPayments: boolean): Prisma.Sql {
  validateAlias(alias);
  return includeUnlinkedPayments ? Prisma.empty : Prisma.raw(`AND "${alias}"."subscriptionId" IS NOT NULL`);
}

// ============================================================================
// DRY: Fórmula MRR reutilizable
// ============================================================================

/**
 * Genera la fórmula SQL para calcular MRR según la unidad de intervalo del plan
 * @param includeCustom - Si incluir soporte para intervalo CUSTOM (usa metadata.mrrFactor)
 * @returns Fragmento SQL para cálculo de MRR
 */
function buildMrrFormula(includeCustom: boolean = false): string {
  const customCase = includeCustom 
    ? `WHEN 'CUSTOM' THEN COALESCE((sp."metadata"->>'mrrFactor')::numeric, 0::numeric)`
    : `ELSE 0::numeric`;
    
  return `CASE sp."intervalUnit"
    WHEN 'MONTH' THEN (1::numeric / GREATEST(sp."intervalCount") )
    WHEN 'WEEK' THEN (4.34524::numeric / GREATEST(sp."intervalCount") )
    WHEN 'DAY' THEN (30.4375::numeric / GREATEST(sp."intervalCount") )
    ${customCase}
  END`;
}

/**
 * Genera la fórmula SQL completa para cálculo de MRR con ROUND
 * @param includeCustom - Si incluir soporte para intervalo CUSTOM
 * @returns Fragmento SQL completo para cálculo de MRR
 */
function buildMrrRoundFormula(includeCustom: boolean = false): string {
  return `ROUND(sp."priceInCents"::numeric * ${buildMrrFormula(includeCustom)})`;
}

function buildResolvedProductIdSql(subscriptionAlias: string, planAlias: string) {
  const s = validateAlias(subscriptionAlias);
  const sp = validateAlias(planAlias);
  return `COALESCE(
    "${s}"."productId",
    NULLIF("${sp}"."metadata"->'catalog'->>'itemId', '')::uuid
  )`;
}

export async function getMetricsOverview(args: { from: Date; to: Date; granularity: Granularity; tenantId?: string | null }) {
  const startTime = Date.now();
  const { from, to } = clampRange(args.from, args.to);
  const { trunc, step } = granularityConfig(args.granularity);
  const tenantId = String(args.tenantId || "").trim();
  const hasTenant = Boolean(tenantId);

  const paymentsCfg = await getPaymentsConfig().catch(() => ({
    includeUnlinkedPaymentsInMetrics: true
  }));
  const includeUnlinkedPayments = paymentsCfg.includeUnlinkedPaymentsInMetrics !== false;

  let buckets: BucketRow[] = [];
  try {
    buckets = (await prisma.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT bucket::timestamptz AS bucket
      FROM generate_series(
        date_trunc(${Prisma.raw(`'${trunc}'`)}, ${from}::timestamptz),
        date_trunc(${Prisma.raw(`'${trunc}'`)}, ${to}::timestamptz),
        ${Prisma.raw(`interval '${step}'`)}
      ) AS bucket
      ORDER BY bucket ASC
    `)) as BucketRow[];
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en buckets:');
  }
  if (!Array.isArray(buckets) || buckets.length === 0) {
    buckets = buildBucketsFallback(from, to, args.granularity);
  }

  const baseSeries = new Map<string, SeriesPoint>();
  for (const b of buckets) {
    const key = bucketKey(b.bucket);
    if (!key) continue;
    baseSeries.set(key, {
      at: key,
      revenueInCents: 0,
      paymentsSuccess: 0,
      paymentsFailed: 0,
      linksSent: 0,
      linksPaid: 0,
      activeSubscriptions: 0
    });
  }

  // PERFORMANCE: Ejecutar queries independientes en paralelo con error handling
  let paymentsAgg: Array<{ bucket: Date; payments_success: bigint; revenue_cents: bigint }> = [];
  let failedAgg: Array<{ bucket: Date; payments_failed: bigint }> = [];
  let linksSentAgg: Array<{ bucket: Date; links_sent: bigint }> = [];
  let linksPaidAgg: Array<{ bucket: Date; links_paid: bigint }> = [];

  try {
    [paymentsAgg, failedAgg, linksSentAgg, linksPaidAgg] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ bucket: Date; payments_success: bigint; revenue_cents: bigint }>>(
        `SELECT date_trunc('${trunc}', p."paidAt") AS bucket,
                COUNT(*)::bigint AS payments_success,
                COALESCE(SUM(p."amountInCents")) ::bigint AS revenue_cents
         FROM "Payment" p
         WHERE p."status" = 'APPROVED'
           AND p."paidAt" IS NOT NULL
           AND p."paidAt" >= $1::timestamptz
           AND p."paidAt" < $2::timestamptz
           ${paymentReconciliationFilter}
           ${paymentUnlinkedFilter}
           ${tf("p") }
         GROUP BY 1
         ORDER BY 1 ASC`,
        from,
        to,
      ),

      prisma.$queryRawUnsafe<Array<{ bucket: Date; payments_failed: bigint }>>(
        `SELECT date_trunc('${trunc}', COALESCE(p."failedAt", p."updatedAt")) AS bucket,
                COUNT(*)::bigint AS payments_failed
         FROM "Payment" p
         WHERE p."status" IN ('DECLINED', 'ERROR', 'VOIDED')
           AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz
           AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz
           ${paymentReconciliationFilter}
           ${paymentUnlinkedFilter}
           ${tf("p") }
         GROUP BY 1
         ORDER BY 1 ASC`,
        from,
        to,
      ),

      prisma.$queryRawUnsafe<Array<{ bucket: Date; links_sent: bigint }>>(
        `SELECT date_trunc('${trunc}', pl."sentAt") AS bucket,
                COUNT(*)::bigint AS links_sent
         FROM "PaymentLink" pl
         INNER JOIN "SubscriptionPlan" sp ON sp."id" = pl."planId"
         WHERE sp."planType" = 'manual_link'
           AND pl."sentAt" >= $1::timestamptz
           AND pl."sentAt" < $2::timestamptz
           ${tf("pl") }
         GROUP BY 1
         ORDER BY 1 ASC`,
        from,
        to,
      ),

      prisma.$queryRawUnsafe<Array<{ bucket: Date; links_paid: bigint }>>(
        `SELECT date_trunc('${trunc}', pl."paidAt") AS bucket,
                COUNT(*)::bigint AS links_paid
         FROM "PaymentLink" pl
         INNER JOIN "SubscriptionPlan" sp ON sp."id" = pl."planId"
         WHERE sp."planType" = 'manual_link'
           AND pl."paidAt" IS NOT NULL
           AND pl."paidAt" >= $1::timestamptz
           AND pl."paidAt" < $2::timestamptz
           ${tf("pl") }
         GROUP BY 1
         ORDER BY 1 ASC`,
        from,
        to,
      )
    ]);
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en queries paralelas:');
  }
  paymentsAgg = Array.isArray(paymentsAgg) ? paymentsAgg : [];
  failedAgg = Array.isArray(failedAgg) ? failedAgg : [];
  linksSentAgg = Array.isArray(linksSentAgg) ? linksSentAgg : [];
  linksPaidAgg = Array.isArray(linksPaidAgg) ? linksPaidAgg : [];

  for (const r of paymentsAgg) {
    const key = bucketKey(r.bucket);
    if (!key) continue;
    const p = baseSeries.get(key);
    if (!p) continue;
    p.paymentsSuccess = num(r.payments_success);
    p.revenueInCents = num(r.revenue_cents);
  }

  for (const r of failedAgg) {
    const key = bucketKey(r.bucket);
    if (!key) continue;
    const p = baseSeries.get(key);
    if (!p) continue;
    p.paymentsFailed = num(r.payments_failed);
  }

  for (const r of linksSentAgg) {
    const key = bucketKey(r.bucket);
    if (!key) continue;
    const p = baseSeries.get(key);
    if (!p) continue;
    p.linksSent = num(r.links_sent);
  }

  for (const r of linksPaidAgg) {
    const key = bucketKey(r.bucket);
    if (!key) continue;
    const p = baseSeries.get(key);
    if (!p) continue;
    p.linksPaid = num(r.links_paid);
  }

  // Active subscriptions (cumulative from start/cancel events).
  const firstBucket = buckets[0]?.bucket ?? from;
  let initialActiveRow: Array<{ c: bigint }> = [{ c: 0n }];
  try {
    initialActiveRow = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*)::bigint AS c
       FROM "Subscription" s
       INNER JOIN "Customer" c ON c."id" = s."customerId"
       WHERE s."status" IN ('ACTIVE', 'PAST_DUE', 'SUSPENDED')
         AND s."startAt" < $1::timestamptz
         AND (s."canceledAt" IS NULL OR s."canceledAt" >= $1::timestamptz)
         ${tf("s") }`,
      firstBucket,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en initialActiveRow:');
  }
  let activeSoFar = num(initialActiveRow[0]?.c ?? 0);

  let startsAgg: Array<{ bucket: Date; starts: bigint }> = [];
  try {
    startsAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; starts: bigint }>>(
      `SELECT date_trunc('${trunc}', s."startAt") AS bucket,
              COUNT(*)::bigint AS starts
       FROM "Subscription" s
       INNER JOIN "Customer" c ON c."id" = s."customerId"
       WHERE s."startAt" >= $1::timestamptz
         AND s."startAt" < $2::timestamptz
         ${tf("s") }
       GROUP BY 1
       ORDER BY 1 ASC`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en startsAgg:');
  }

  let cancelsAgg: Array<{ bucket: Date; cancels: bigint }> = [];
  try {
    cancelsAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; cancels: bigint }>>(
      `SELECT date_trunc('${trunc}', s."canceledAt") AS bucket,
              COUNT(*)::bigint AS cancels
       FROM "Subscription" s
       INNER JOIN "Customer" c ON c."id" = s."customerId"
       WHERE s."canceledAt" IS NOT NULL
         AND s."canceledAt" >= $1::timestamptz
         AND s."canceledAt" < $2::timestamptz
         ${tf("s") }
       GROUP BY 1
       ORDER BY 1 ASC`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en cancelsAgg:');
  }

  const startsByBucket = new Map<string, number>();
  for (const r of startsAgg) {
    const key = bucketKey(r.bucket);
    if (key) startsByBucket.set(key, num(r.starts));
  }
  const cancelsByBucket = new Map<string, number>();
  for (const r of cancelsAgg) {
    const key = bucketKey(r.bucket);
    if (key) cancelsByBucket.set(key, num(r.cancels));
  }

  for (const b of buckets) {
    const key = bucketKey(b.bucket);
    if (!key) continue;
    activeSoFar += startsByBucket.get(key) ?? 0;
    activeSoFar -= cancelsByBucket.get(key) ?? 0;
    const p = baseSeries.get(key);
    if (p) p.activeSubscriptions = Math.max(0, activeSoFar);
  }

  // Totals (range + snapshots)
  let totalsPaymentsRow: Array<{ payments_success: bigint; payments_failed: bigint; revenue_cents: bigint }> = [{ payments_success: 0n, payments_failed: 0n, revenue_cents: 0n }];
  try {
    totalsPaymentsRow = await prisma.$queryRawUnsafe<
      Array<{ payments_success: bigint; payments_failed: bigint; revenue_cents: bigint }>
    >(
      `SELECT
          COUNT(*) FILTER (WHERE p."status" = 'APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)::bigint AS payments_success,
          COUNT(*) FILTER (WHERE p."status" IN ('DECLINED','ERROR','VOIDED') AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz)::bigint AS payments_failed,
          COALESCE(SUM(p."amountInCents") FILTER (WHERE p."status" = 'APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)) ::bigint AS revenue_cents
        FROM "Payment" p
        WHERE 1=1
        ${paymentReconciliationFilter}
        ${paymentUnlinkedFilter}
        ${tf("p") }`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en totalsPaymentsRow:');
  }

  let paymentsByPlanType: PaymentsByPlanTypeRow[] = [];
  try {
    paymentsByPlanType = await prisma.$queryRawUnsafe<PaymentsByPlanTypeRow[]>(
      `SELECT
          sp."planType" AS plan_type,
          COUNT(*) FILTER (WHERE p."status"='APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)::bigint AS payments_success,
          COUNT(*) FILTER (WHERE p."status" IN ('DECLINED','ERROR','VOIDED') AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz)::bigint AS payments_failed,
          COALESCE(SUM(p."amountInCents") FILTER (WHERE p."status"='APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)) ::bigint AS revenue_cents
        FROM "Payment" p
        INNER JOIN "Subscription" s ON s."id" = p."subscriptionId"
        INNER JOIN "Customer" c ON c."id" = s."customerId"
        INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
        WHERE p."subscriptionId" IS NOT NULL
          AND (
            (p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)
            OR (COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz)
          )
          ${paymentReconciliationFilter}
          ${paymentUnlinkedFilter}
          ${tf("p") }
        GROUP BY 1`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en paymentsByPlanType:');
  }
  const paymentsByPlanTypeTotals: Record<string, { paymentsSuccess: number; paymentsFailed: number; revenueInCents: number }> = {
    manual_link: { paymentsSuccess: 0, paymentsFailed: 0, revenueInCents: 0 },
    auto_subscription: { paymentsSuccess: 0, paymentsFailed: 0, revenueInCents: 0 }
  };
  for (const r of paymentsByPlanType) {
    const key = String(r.plan_type);
    paymentsByPlanTypeTotals[key] = {
      paymentsSuccess: num(r.payments_success),
      paymentsFailed: num(r.payments_failed),
      revenueInCents: num(r.revenue_cents)
    };
  }

  // DESGLOSE POR PLATAFORMA (Shopify, Alegra, Manual, Direct, etc.)
  let platformBreakdown: Array<{ source: string; payments_success: bigint; payments_failed: bigint; revenue_cents: bigint }> = [];
  try {
    platformBreakdown = await prisma.$queryRawUnsafe<
      Array<{ source: string; payments_success: bigint; payments_failed: bigint; revenue_cents: bigint }>
    >(
      `SELECT
          COALESCE(
            p."providerResponse"->>'source',
            p."providerResponse"->'order'->>'source',
            p."providerResponse"->'webhook'->'data'->'transaction'->>'source',
            'DIRECT'
          ) AS source,
          COUNT(*) FILTER (WHERE p."status" = 'APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)::bigint AS payments_success,
          COUNT(*) FILTER (WHERE p."status" IN ('DECLINED','ERROR','VOIDED') AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz)::bigint AS payments_failed,
          COALESCE(SUM(p."amountInCents") FILTER (WHERE p."status" = 'APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)) ::bigint AS revenue_cents
        FROM "Payment" p
        WHERE (p."paidAt" IS NOT NULL OR p."status" IN ('DECLINED','ERROR','VOIDED'))
          AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz
          AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz
          AND p."createdAt" >= $1::timestamptz
          AND p."createdAt" < $2::timestamptz
          ${paymentReconciliationFilter}
          ${paymentUnlinkedFilter}
          ${tf("p") }
        GROUP BY 1
        ORDER BY payments_success DESC`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en platformBreakdown:');
  }

  let totalsPlansSoldRow: Array<{ plans_sold: bigint }> = [{ plans_sold: 0n }];
  try {
    totalsPlansSoldRow = await prisma.$queryRawUnsafe<Array<{ plans_sold: bigint }>>(
      `WITH first_paid AS (
         SELECT p."subscriptionId", MIN(p."paidAt") AS first_paid_at
         FROM "Payment" p
         INNER JOIN "Subscription" s ON s."id" = p."subscriptionId"
         INNER JOIN "Customer" c ON c."id" = s."customerId"
         WHERE p."subscriptionId" IS NOT NULL
           AND p."status" = 'APPROVED'
           AND p."paidAt" IS NOT NULL
           ${paymentReconciliationFilter}
           ${tf("p") }
         GROUP BY p."subscriptionId"
       )
       SELECT COUNT(*)::bigint AS plans_sold
       FROM first_paid
       WHERE first_paid_at >= $1::timestamptz AND first_paid_at < $2::timestamptz`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en totalsPlansSoldRow:');
  }

  const activeSubsRow = await prisma.subscription.count({
    where: {
      status: { in: ACTIVE_SUBSCRIPTION_STATUSES },
      startAt: { lt: to },
      OR: [{ canceledAt: null }, { canceledAt: { gte: to } }],
      ...(hasTenant ? { tenantId } : {})
    }
  });
  let contactsStatusRow: Array<{ contacts_on_time: bigint; contacts_past_due: bigint }> = [{ contacts_on_time: 0n, contacts_past_due: 0n }];
  try {
    const metricSubscriptions = await prisma.subscription.findMany({
      where: {
        startAt: { lt: to },
        OR: [{ canceledAt: null }, { canceledAt: { gte: to } }],
        ...(hasTenant ? { tenantId } : {})
      },
      select: {
        id: true,
        customerId: true,
        status: true,
        startAt: true,
        cycleStartDay: true,
        paymentDay: true,
        paymentTiming: true,
        graceDays: true,
        plan: { select: { intervalUnit: true, intervalCount: true } }
      }
    });
    const billingStateBySubscription = await buildSubscriptionBillingStateIndex({
      subscriptions: metricSubscriptions.map((sub) => ({
        id: sub.id,
        startAt: sub.startAt,
        cycleStartDay: sub.cycleStartDay,
        paymentDay: sub.paymentDay,
        paymentTiming: (sub.paymentTiming as any) === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO",
        graceDays: sub.graceDays,
        plan: {
          intervalUnit: sub.plan.intervalUnit,
          intervalCount: sub.plan.intervalCount
        }
      })),
      ensureCycles: false,
      asOf: to
    });
    const onTime = new Set<string>();
    const pastDue = new Set<string>();
    for (const sub of metricSubscriptions) {
      const billingState = billingStateBySubscription.get(String(sub.id)) || null;
      const collectionCycle = billingState?.collectionCycle || billingState?.activeCycle || null;
      const collectionState = resolveCollectionDelinquency({
        cycle: collectionCycle,
        graceDays: sub.graceDays,
        asOf: to,
        fallbackSubscriptionStatus: sub.status
      });
      if (collectionState.status === "EN_MORA") pastDue.add(String(sub.customerId));
      else onTime.add(String(sub.customerId));
    }
    for (const customerId of pastDue) onTime.delete(customerId);
    contactsStatusRow = [{ contacts_on_time: BigInt(onTime.size), contacts_past_due: BigInt(pastDue.size) }];
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en contactsStatusRow:');
  }

  const linksTotalsRow = await prisma.$queryRawUnsafe<
    Array<{ links_sent: bigint; links_paid_any: bigint; links_paid_in_range: bigint; link_revenue_cents: bigint; avg_time_to_pay_sec: number | null }>
  >(
    `WITH sent_in_range AS (
       SELECT pl.*
       FROM "PaymentLink" pl
       JOIN "SubscriptionPlan" sp ON sp."id" = pl."planId"
       WHERE sp."planType" = 'manual_link'
         AND pl."sentAt" >= $1::timestamptz
         AND pl."sentAt" < $2::timestamptz
         ${tf("pl") }
     )
     SELECT
       COUNT(*)::bigint AS links_sent,
       COUNT(*) FILTER (WHERE pl."paidAt" IS NOT NULL)::bigint AS links_paid_any,
       COUNT(*) FILTER (WHERE pl."paidAt" IS NOT NULL AND pl."paidAt" >= $1::timestamptz AND pl."paidAt" < $2::timestamptz)::bigint AS links_paid_in_range,
       COALESCE(SUM(p."amountInCents") FILTER (WHERE p."status"='APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)) ::bigint AS link_revenue_cents,
       AVG(EXTRACT(EPOCH FROM (pl."paidAt" - pl."sentAt"))) FILTER (WHERE pl."paidAt" IS NOT NULL AND pl."paidAt" >= pl."sentAt") AS avg_time_to_pay_sec
     FROM sent_in_range pl
     LEFT JOIN "Payment" p ON p."id" = pl."paymentId"`,
    from,
    to,
  ).catch((err) => {
    logger.warn({ err }, "Error in linksTotalsRow:");
    return [{ links_sent: 0n, links_paid_any: 0n, links_paid_in_range: 0n, link_revenue_cents: 0n, avg_time_to_pay_sec: null }];
  });

  const autoSubsSnapshot = await prisma.subscription.count({
    where: {
      status: { in: ACTIVE_SUBSCRIPTION_STATUSES },
      plan: { planType: PlanType.auto_subscription },
      startAt: { lt: to },
      OR: [{ canceledAt: null }, { canceledAt: { gte: to } }],
      ...(hasTenant ? { tenantId } : {})
    }
  });

  const newAutoSubsRow = await prisma.subscription.count({
    where: {
      plan: { planType: PlanType.auto_subscription },
      createdAt: { gte: from, lt: to },
      ...(hasTenant ? { tenantId } : {})
    }
  });

  const canceledAutoSubsRow = await prisma.subscription.count({
    where: {
      plan: { planType: PlanType.auto_subscription },
      canceledAt: { gte: from, lt: to },
      ...(hasTenant ? { tenantId } : {})
    }
  });

  let autoChargesRow: Array<{ ok: bigint; failed: bigint }> = [{ ok: 0n, failed: 0n }];
  try {
    autoChargesRow = await prisma.$queryRawUnsafe<Array<{ ok: bigint; failed: bigint }>>(
      `SELECT
          COUNT(*) FILTER (WHERE p."status"='APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)::bigint AS ok,
          COUNT(*) FILTER (WHERE p."status" IN ('DECLINED','ERROR','VOIDED') AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz)::bigint AS failed
        FROM "Payment" p
        INNER JOIN "Subscription" s ON s."id" = p."subscriptionId"
        INNER JOIN "Customer" c ON c."id" = s."customerId"
        INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
        WHERE sp."planType" = 'auto_subscription'
          AND p."wompiTransactionId" IS NOT NULL
          ${paymentReconciliationFilter}
          ${paymentUnlinkedFilter}
          ${tf("p") }`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en autoChargesRow:');
  }

  const mrrRow = await prisma.$queryRawUnsafe<Array<{ mrr_cents: number | null }>>(
    `SELECT
        COALESCE(SUM(${buildMrrRoundFormula(true)})) ::numeric AS mrr_cents
      FROM "Subscription" s
      INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
      INNER JOIN "Customer" c ON c."id" = s."customerId"
      WHERE sp."planType" = 'auto_subscription'
        AND s."status" IN ('ACTIVE','PAST_DUE','SUSPENDED')
        AND s."startAt" < $1::timestamptz
        AND (s."canceledAt" IS NULL OR s."canceledAt" >= $1::timestamptz)
        ${tf("s") }`,
    to,
  );

  const { start: churnStart, end: churnEnd } = monthBoundsUtc(new Date(to.getTime() - 1));
  let churnRow: Array<{ cancels: bigint; active_start: bigint }> = [{ cancels: 0n, active_start: 0n }];
  try {
    churnRow = await prisma.$queryRawUnsafe<Array<{ cancels: bigint; active_start: bigint }>>(
      `SELECT
          COUNT(*) FILTER (WHERE s."canceledAt" IS NOT NULL AND s."canceledAt" >= $1::timestamptz AND s."canceledAt" < $2::timestamptz)::bigint AS cancels,
          COUNT(*) FILTER (
            WHERE s."startAt" < $1::timestamptz
              AND (s."canceledAt" IS NULL OR s."canceledAt" >= $1::timestamptz)
          )::bigint AS active_start
        FROM "Subscription" s
        INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
        INNER JOIN "Customer" c ON c."id" = s."customerId"
        WHERE sp."planType" = 'auto_subscription'
        ${tf("s") }`,
      churnStart,
      churnEnd,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en churnRow:');
  }

  const cancels = num(churnRow[0]?.cancels ?? 0);
  const activeStart = num(churnRow[0]?.active_start ?? 0);
  const churnMonthlyPct = activeStart > 0 ? (cancels / activeStart) * 100 : null;

  let revenueByPlanType: Array<{ plan_type: PlanType; revenue_cents: bigint }> = [];
  try {
    revenueByPlanType = await prisma.$queryRawUnsafe<Array<{ plan_type: PlanType; revenue_cents: bigint }>>(
      `SELECT sp."planType" AS plan_type,
              COALESCE(SUM(p."amountInCents")) ::bigint AS revenue_cents
       FROM "Payment" p
       INNER JOIN "Subscription" s ON s."id" = p."subscriptionId"
       INNER JOIN "Customer" c ON c."id" = s."customerId"
       INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
       WHERE p."status"='APPROVED'
         AND p."paidAt" IS NOT NULL
         AND p."paidAt" >= $1::timestamptz
         AND p."paidAt" < $2::timestamptz
         ${paymentReconciliationFilter}
         ${paymentUnlinkedFilter}
         ${tf("p") }
       GROUP BY 1`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en revenueByPlanType:');
  }
  const revenueByPlanTypeInCents: Record<string, number> = { manual_link: 0, auto_subscription: 0 };
  for (const r of revenueByPlanType) revenueByPlanTypeInCents[String(r.plan_type)] = num(r.revenue_cents);

  let revenueByProduct: Array<{ product_id: string | null; product_name: string | null; payments_success: bigint; revenue_cents: bigint }> = [];
  try {
    const resolvedProductIdSql = buildResolvedProductIdSql("s", "sp");
    revenueByProduct = await prisma.$queryRawUnsafe<
      Array<{ product_id: string | null; product_name: string | null; payments_success: bigint; revenue_cents: bigint }>
    >(
      `SELECT
          ${resolvedProductIdSql}::text AS product_id,
          COALESCE(prod."metadata"->>'displayName', prod."name", 'Sin producto') AS product_name,
          COUNT(*) FILTER (
            WHERE p."status"='APPROVED'
              AND p."paidAt" IS NOT NULL
              AND p."paidAt" >= $1::timestamptz
              AND p."paidAt" < $2::timestamptz
          )::bigint AS payments_success,
          COALESCE(SUM(p."amountInCents") FILTER (
            WHERE p."status"='APPROVED'
              AND p."paidAt" IS NOT NULL
              AND p."paidAt" >= $1::timestamptz
              AND p."paidAt" < $2::timestamptz
          ), 0)::bigint AS revenue_cents
       FROM "Payment" p
       INNER JOIN "Subscription" s ON s."id" = p."subscriptionId"
       INNER JOIN "Customer" c ON c."id" = s."customerId"
       INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
       LEFT JOIN "SubscriptionPlan" prod ON prod."id" = ${resolvedProductIdSql}
       WHERE p."subscriptionId" IS NOT NULL
         AND p."status"='APPROVED'
         AND p."paidAt" IS NOT NULL
         AND p."paidAt" >= $1::timestamptz
         AND p."paidAt" < $2::timestamptz
         ${paymentReconciliationFilter}
         ${paymentUnlinkedFilter}
         ${tf("p") }
       GROUP BY 1, 2
       ORDER BY revenue_cents DESC, payments_success DESC
       LIMIT 12`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en revenueByProduct:');
  }
  const revenueByProductRows = revenueByProduct
    .filter((r) => String(r.product_id || "").trim())
    .map((r) => ({
      productId: String(r.product_id || ""),
      productName: String(r.product_name || "Sin producto"),
      paymentsSuccess: num(r.payments_success),
      revenueInCents: num(r.revenue_cents)
    }));

  let paymentActivityByProduct: Array<{
    product_id: string | null;
    product_name: string | null;
    payments_success: bigint;
    payments_failed: bigint;
    revenue_cents: bigint;
  }> = [];
  try {
    const resolvedProductIdSql = buildResolvedProductIdSql("s", "sp");
    paymentActivityByProduct = await prisma.$queryRawUnsafe<
      Array<{
        product_id: string | null;
        product_name: string | null;
        payments_success: bigint;
        payments_failed: bigint;
        revenue_cents: bigint;
      }>
    >(
      `SELECT
          ${resolvedProductIdSql}::text AS product_id,
          COALESCE(prod."metadata"->>'displayName', prod."name", 'Sin producto') AS product_name,
          COUNT(*) FILTER (
            WHERE p."status"='APPROVED'
              AND p."paidAt" IS NOT NULL
              AND p."paidAt" >= $1::timestamptz
              AND p."paidAt" < $2::timestamptz
          )::bigint AS payments_success,
          COUNT(*) FILTER (
            WHERE p."status" IN ('DECLINED','ERROR','VOIDED')
              AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz
              AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz
          )::bigint AS payments_failed,
          COALESCE(SUM(p."amountInCents") FILTER (
            WHERE p."status"='APPROVED'
              AND p."paidAt" IS NOT NULL
              AND p."paidAt" >= $1::timestamptz
              AND p."paidAt" < $2::timestamptz
          ), 0)::bigint AS revenue_cents
       FROM "Payment" p
       INNER JOIN "Subscription" s ON s."id" = p."subscriptionId"
       INNER JOIN "Customer" c ON c."id" = s."customerId"
       INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
       LEFT JOIN "SubscriptionPlan" prod ON prod."id" = ${resolvedProductIdSql}
       WHERE p."subscriptionId" IS NOT NULL
         AND (
           (p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)
           OR (COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz)
         )
         ${paymentReconciliationFilter}
         ${paymentUnlinkedFilter}
         ${tf("p") }
       GROUP BY 1, 2
       ORDER BY revenue_cents DESC, payments_success DESC, payments_failed DESC
       LIMIT 12`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en paymentActivityByProduct:');
  }
  const paymentActivityByProductRows = paymentActivityByProduct
    .filter((r) => String(r.product_id || "").trim())
    .map((r) => ({
      productId: String(r.product_id || ""),
      productName: String(r.product_name || "Sin producto"),
      paymentsSuccess: num(r.payments_success),
      paymentsFailed: num(r.payments_failed),
      revenueInCents: num(r.revenue_cents)
    }));

  let linkActivityByProduct: Array<{
    product_id: string | null;
    product_name: string | null;
    links_sent: bigint;
    links_paid: bigint;
    revenue_cents: bigint;
  }> = [];
  try {
    linkActivityByProduct = await prisma.$queryRawUnsafe<
      Array<{
        product_id: string | null;
        product_name: string | null;
        links_sent: bigint;
        links_paid: bigint;
        revenue_cents: bigint;
      }>
    >(
      `SELECT
          COALESCE(
            pl."productId",
            NULLIF(sp."metadata"->'catalog'->>'itemId', '')::uuid
          )::text AS product_id,
          COALESCE(prod."metadata"->>'displayName', prod."name", 'Sin producto') AS product_name,
          COUNT(*) FILTER (
            WHERE pl."sentAt" >= $1::timestamptz
              AND pl."sentAt" < $2::timestamptz
          )::bigint AS links_sent,
          COUNT(*) FILTER (
            WHERE pl."paidAt" IS NOT NULL
              AND pl."paidAt" >= $1::timestamptz
              AND pl."paidAt" < $2::timestamptz
          )::bigint AS links_paid,
          COALESCE(SUM(p."amountInCents") FILTER (
            WHERE p."status"='APPROVED'
              AND p."paidAt" IS NOT NULL
              AND p."paidAt" >= $1::timestamptz
              AND p."paidAt" < $2::timestamptz
          ), 0)::bigint AS revenue_cents
       FROM "PaymentLink" pl
       INNER JOIN "SubscriptionPlan" sp ON sp."id" = pl."planId"
       LEFT JOIN "SubscriptionPlan" prod ON prod."id" = COALESCE(
         pl."productId",
         NULLIF(sp."metadata"->'catalog'->>'itemId', '')::uuid
       )
       LEFT JOIN "Payment" p ON p."id" = pl."paymentId"
       WHERE sp."planType" = 'manual_link'
         AND (
           (pl."sentAt" >= $1::timestamptz AND pl."sentAt" < $2::timestamptz)
           OR (pl."paidAt" IS NOT NULL AND pl."paidAt" >= $1::timestamptz AND pl."paidAt" < $2::timestamptz)
         )
         ${tf("pl") }
       GROUP BY 1, 2
       ORDER BY revenue_cents DESC, links_paid DESC, links_sent DESC
       LIMIT 12`,
      from,
      to,
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en linkActivityByProduct:');
  }
  const linkActivityByProductRows = linkActivityByProduct
    .filter((r) => String(r.product_id || "").trim())
    .map((r) => ({
      productId: String(r.product_id || ""),
      productName: String(r.product_name || "Sin producto"),
      linksSent: num(r.links_sent),
      linksPaid: num(r.links_paid),
      revenueInCents: num(r.revenue_cents)
    }));

  let firstDataRow: Array<{ first_at: Date | null }> = [{ first_at: null }];
  try {
    firstDataRow = await prisma.$queryRawUnsafe<Array<{ first_at: Date | null }>>(
      `SELECT MIN(first_at) AS first_at
       FROM (
         SELECT MIN(p."paidAt") AS first_at
         FROM "Payment" p
         INNER JOIN "Customer" c ON c."id" = p."customerId"
         WHERE p."paidAt" IS NOT NULL
         ${paymentReconciliationFilter}
         ${paymentUnlinkedFilter}
         ${hasTenant ? 'AND p."tenantId" = $1::uuid' : ""}
         UNION ALL
         SELECT MIN(pl."sentAt") AS first_at
         FROM "PaymentLink" pl
         INNER JOIN "Payment" p ON p."id" = pl."paymentId"
         INNER JOIN "Customer" c ON c."id" = p."customerId"
         WHERE pl."sentAt" IS NOT NULL
         ${hasTenant ? 'AND pl."tenantId" = $1::uuid' : ""}
         UNION ALL
         SELECT MIN(s."startAt") AS first_at
         FROM "Subscription" s
         INNER JOIN "Customer" c ON c."id" = s."customerId"
         WHERE s."startAt" IS NOT NULL
         ${hasTenant ? 'AND s."tenantId" = $1::uuid' : ""}
       ) t`,
      ...(hasTenant ? [tenantId] : [])
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en firstDataRow:');
  }
  const firstDataAt = firstDataRow[0]?.first_at ? iso(firstDataRow[0].first_at) : null;

  // Optional: month-only series for auto subs MRR + churn.
  if (args.granularity === "month" && buckets.length) {
    let initialMrrRow: Array<{ v: number | null }> = [{ v: null }];
    try {
      initialMrrRow = await prisma.$queryRawUnsafe<Array<{ v: number | null }>>(
        `SELECT
            COALESCE(SUM(${buildMrrRoundFormula(true)})) ::numeric AS v
          FROM "Subscription" s
          INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
          INNER JOIN "Customer" c ON c."id" = s."customerId"
          WHERE sp."planType" = 'auto_subscription'
            AND s."status" IN ('ACTIVE','PAST_DUE','SUSPENDED')
            AND s."startAt" < $1::timestamptz
            AND (s."canceledAt" IS NULL OR s."canceledAt" >= $1::timestamptz)
            ${tf("s") }`,
        firstBucket,
      );
    } catch (err) {
      logger.warn({ err }, '[Metrics] Error en initialMrrRow:');
    }
    let mrrSoFar = Math.round(num(initialMrrRow[0]?.v ?? 0));

    let mrrStartsAgg: Array<{ bucket: Date; adds: number | null }> = [];
    try {
      mrrStartsAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; adds: number | null }>>(
        `SELECT date_trunc('${trunc}', s."startAt") AS bucket,
                COALESCE(SUM(${buildMrrRoundFormula(true)})) ::numeric AS adds
          FROM "Subscription" s
          INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
          INNER JOIN "Customer" c ON c."id" = s."customerId"
          WHERE sp."planType" = 'auto_subscription'
            AND s."startAt" >= $1::timestamptz
            AND s."startAt" < $2::timestamptz
            ${tf("s") }
          GROUP BY 1
          ORDER BY 1 ASC`,
        from,
        to,
      );
    } catch (err) {
      logger.warn({ err }, '[Metrics] Error en mrrStartsAgg:');
    }

    let mrrCancelsAgg: Array<{ bucket: Date; subs: number | null }> = [];
    try {
      mrrCancelsAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; subs: number | null }>>(
        `SELECT date_trunc('${trunc}', s."canceledAt") AS bucket,
                COALESCE(SUM(${buildMrrRoundFormula(true)})) ::numeric AS subs
          FROM "Subscription" s
          INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
          INNER JOIN "Customer" c ON c."id" = s."customerId"
          WHERE sp."planType" = 'auto_subscription'
            AND s."canceledAt" IS NOT NULL
            AND s."canceledAt" >= $1::timestamptz
            AND s."canceledAt" < $2::timestamptz
            ${tf("s") }
          GROUP BY 1
          ORDER BY 1 ASC`,
        from,
        to,
      );
    } catch (err) {
      logger.warn({ err }, '[Metrics] Error en mrrCancelsAgg:');
    }

    const mrrAddsByBucket = new Map<string, number>();
    for (const r of mrrStartsAgg) {
      const key = bucketKey(r.bucket);
      if (key) mrrAddsByBucket.set(key, Math.round(num(r.adds ?? 0)));
    }
    const mrrSubsByBucket = new Map<string, number>();
    for (const r of mrrCancelsAgg) {
      const key = bucketKey(r.bucket);
      if (key) mrrSubsByBucket.set(key, Math.round(num(r.subs ?? 0)));
    }

    for (const b of buckets) {
      const key = bucketKey(b.bucket);
      if (!key) continue;
      mrrSoFar += mrrAddsByBucket.get(key) ?? 0;
      mrrSoFar -= mrrSubsByBucket.get(key) ?? 0;
      const p = baseSeries.get(key);
      if (p) p.mrrInCents = Math.max(0, mrrSoFar);
    }

    let churnAgg: Array<{ bucket: Date; cancels: bigint; active_start: bigint }> = [];
    try {
      churnAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; cancels: bigint; active_start: bigint }>>(
        `WITH months AS (
           SELECT bucket::timestamptz AS bucket
           FROM generate_series(date_trunc('month', $1::timestamptz), date_trunc('month', $2::timestamptz), interval '1 month') AS bucket
         )
         SELECT
           m.bucket AS bucket,
           (
             SELECT COUNT(*)::bigint
             FROM "Subscription" s
             INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
             INNER JOIN "Customer" c ON c."id" = s."customerId"
             WHERE sp."planType"='auto_subscription'
               AND s."canceledAt" IS NOT NULL
               AND s."canceledAt" >= m.bucket
               AND s."canceledAt" < (m.bucket + interval '1 month')
               ${tf("s") }
           ) AS cancels,
           (
             SELECT COUNT(*)::bigint
             FROM "Subscription" s
             INNER JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
             INNER JOIN "Customer" c ON c."id" = s."customerId"
             WHERE sp."planType"='auto_subscription'
               AND s."startAt" < m.bucket
               AND (s."canceledAt" IS NULL OR s."canceledAt" >= m.bucket)
               ${tf("s") }
           ) AS active_start
         FROM months m
         ORDER BY m.bucket ASC`,
        from,
        to,
      );
    } catch (err) {
      logger.warn({ err }, '[Metrics] Error en churnAgg:');
    }

    for (const r of churnAgg) {
      const key = bucketKey(r.bucket);
      if (!key) continue;
      const p = baseSeries.get(key);
      if (!p) continue;
      const c = num(r.cancels);
      const a = num(r.active_start);
      p.churnMonthlyPct = a > 0 ? (c / a) * 100 : null;
    }
  }

  const series = Array.from(baseSeries.values()).sort((a, b) => a.at.localeCompare(b.at));

  // Calcular pagos sin suscripción (one-time, huérfanos, links manuales)
  const unlinkedPaymentsQuery = `
    SELECT
      COUNT(*) FILTER (WHERE p.status = 'APPROVED') as payments_approved,
      COUNT(*) FILTER (WHERE p.status IN ('PENDING', 'DECLINED', 'ERROR', 'VOIDED')) as payments_other,
      COALESCE(SUM(p."amountInCents") FILTER (WHERE p.status = 'APPROVED'))  as revenue_cents
    FROM "Payment" p
    INNER JOIN "Customer" c ON c."id" = p."customerId"
    WHERE p."subscriptionId" IS NULL
      AND p."createdAt" >= $1::timestamptz
      AND p."createdAt" < $2::timestamptz
      ${tenantFilter('p', 3, hasTenant)}
  `;
  let unlinkedPaymentsRow: UnlinkedPaymentsRow[] = [{ payments_approved: 0n, payments_other: 0n, revenue_cents: 0n }];
  try {
    unlinkedPaymentsRow = await prisma.$queryRawUnsafe<UnlinkedPaymentsRow[]>(
      unlinkedPaymentsQuery,
      from,
      to,
      tenantId
    );
  } catch (err) {
    logger.warn({ err }, '[Metrics] Error en unlinkedPaymentsRow:');
  }

  const result = {
    range: { from: iso(from), to: iso(to), granularity: args.granularity },
    totals: {
      totalPlansSold: num(totalsPlansSoldRow[0]?.plans_sold ?? 0),
      totalActiveSubscriptions: activeSubsRow,
      contactsOnTime: num(contactsStatusRow[0]?.contacts_on_time ?? 0),
      contactsPastDue: num(contactsStatusRow[0]?.contacts_past_due ?? 0),
      totalPaymentsSuccessful: num(totalsPaymentsRow[0]?.payments_success ?? 0),
      totalPaymentsFailed: num(totalsPaymentsRow[0]?.payments_failed ?? 0),
      totalRevenueInCents: num(totalsPaymentsRow[0]?.revenue_cents ?? 0),
      link: {
        linksSent: num(linksTotalsRow[0]?.links_sent ?? 0),
        linksPaid: num(linksTotalsRow[0]?.links_paid_in_range ?? (linksTotalsRow[0] as any)?.links_paid ?? 0),
        conversionLinkToPayPct:
          num(linksTotalsRow[0]?.links_sent ?? 0) > 0
            ? (num(linksTotalsRow[0]?.links_paid_in_range ?? (linksTotalsRow[0] as any)?.links_paid ?? 0) / num(linksTotalsRow[0]?.links_sent ?? 0)) * 100
            : null,
        revenueInCents: num(linksTotalsRow[0]?.link_revenue_cents ?? 0),
        avgTimeToPaySec: linksTotalsRow[0]?.avg_time_to_pay_sec == null ? null : Number(linksTotalsRow[0]?.avg_time_to_pay_sec)
      },
      auto: {
        activeSubscriptions: autoSubsSnapshot,
        newSubscriptions: newAutoSubsRow,
        cancellations: canceledAutoSubsRow,
        autoChargesSuccessful: num(autoChargesRow[0]?.ok ?? 0),
        autoChargesFailed: num(autoChargesRow[0]?.failed ?? 0),
        mrrInCents: Math.round(num(mrrRow[0]?.mrr_cents ?? 0)),
        churnMonthlyPct
      },
      unlinked: {
        paymentsApproved: num(unlinkedPaymentsRow[0]?.payments_approved ?? 0),
        paymentsOther: num(unlinkedPaymentsRow[0]?.payments_other ?? 0),
        revenueInCents: num(unlinkedPaymentsRow[0]?.revenue_cents ?? 0)
      },
      byPlanType: paymentsByPlanTypeTotals,
      byPlatform: platformBreakdown.map((r) => ({
        source: r.source,
        paymentsSuccess: num(r.payments_success),
        paymentsFailed: num(r.payments_failed),
        revenueInCents: num(r.revenue_cents)
      }))
    },
    breakdown: {
      revenueByPlanTypeInCents,
      revenueByProduct: revenueByProductRows,
      paymentActivityByProduct: paymentActivityByProductRows,
      linkActivityByProduct: linkActivityByProductRows
    },
    meta: {
      firstDataAt
    },
    series
  };
  
  // Logging estructurado para observabilidad
  const duration = Date.now() - startTime;
  logger.info({
    tenantId: hasTenant ? tenantId : null,
    granularity: args.granularity,
    rangeDays: Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)),
    seriesPoints: series.length,
    durationMs: duration,
    slow: duration > 2000
  }, "[MetricsOverview] completed");
  
  return result;
}
