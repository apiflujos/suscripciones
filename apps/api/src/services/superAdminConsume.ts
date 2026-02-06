import { prisma } from "../db/prisma";
import { SaPeriodType, SaPlanKind } from "@prisma/client";

type ServiceRule = {
  isUnlimited: boolean;
  maxValue: number | null;
  unitPriceInCents: number;
};

type SnapshotShape = {
  planKey?: string;
  planName?: string;
  kind?: SaPlanKind | string;
  monthlyPriceInCents?: number;
  services?: Record<string, Partial<ServiceRule> | undefined>;
};

function monthKeyUtc(d: Date) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function intAmount(v: unknown, fallback = 1) {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function normalizeKind(v: unknown): SaPlanKind | null {
  if (!v) return null;
  const s = String(v);
  if (s === SaPlanKind.MASTER) return SaPlanKind.MASTER;
  if (s === SaPlanKind.PRO) return SaPlanKind.PRO;
  if (s === SaPlanKind.ON_DEMAND) return SaPlanKind.ON_DEMAND;
  return null;
}

function ruleFromSnapshot(kind: SaPlanKind, serviceKey: string, snap: SnapshotShape): ServiceRule {
  const raw = (snap.services && snap.services[serviceKey]) || {};
  const isUnlimitedRaw = raw.isUnlimited;
  const maxValueRaw = raw.maxValue;
  const unitPriceRaw = raw.unitPriceInCents;

  const isUnlimited = typeof isUnlimitedRaw === "boolean" ? isUnlimitedRaw : kind === SaPlanKind.MASTER || kind === SaPlanKind.ON_DEMAND;
  const maxValue = maxValueRaw == null ? null : intAmount(maxValueRaw, 0);
  const unitPriceInCents = intAmount(unitPriceRaw, 0);

  if (kind === SaPlanKind.MASTER) return { isUnlimited: true, maxValue: null, unitPriceInCents: 0 };
  if (kind === SaPlanKind.ON_DEMAND) return { isUnlimited: true, maxValue: null, unitPriceInCents };
  return { isUnlimited, maxValue, unitPriceInCents };
}

async function isServiceEnabledForTenant(args: { tenantId: string; moduleKey: string }): Promise<{
  enabled: boolean;
  reason: null | "module_inactive" | "module_disabled";
}> {
  const def = await prisma.saModuleDefinition.findUnique({ where: { key: args.moduleKey } });
  if (!def) return { enabled: true, reason: null };
  if (!def.active) return { enabled: false, reason: "module_inactive" };

  const toggle = await prisma.saTenantModuleToggle.findUnique({
    where: { tenantId_moduleKey: { tenantId: args.tenantId, moduleKey: args.moduleKey } }
  });
  if (!toggle) return { enabled: true, reason: null };
  return toggle.enabled ? { enabled: true, reason: null } : { enabled: false, reason: "module_disabled" };
}

export async function consumeLimitOrBlock(
  serviceKey: string,
  args: {
    tenantId: string;
    amount?: number;
    source?: string;
    meta?: any;
  }
): Promise<{
  blocked: boolean;
  blockReason: string | null;
  periodType: SaPeriodType;
  periodKey: string;
  usageTotal: number;
  billed: null | { quantity: number; unitPriceInCents: number; totalInCents: number };
}> {
  const amount = intAmount(args.amount ?? 1, 1);
  if (!serviceKey || !args.tenantId) throw new Error("invalid_args");
  if (amount <= 0) throw new Error("amount_must_be_positive");

  const def = await prisma.saLimitDefinition.findUnique({ where: { key: serviceKey } });
  if (!def || !def.active) throw new Error("service_not_configured");

  const periodType = def.periodType;
  const periodKey = periodType === SaPeriodType.total ? "total" : monthKeyUtc(new Date());

  const enabled = await isServiceEnabledForTenant({ tenantId: args.tenantId, moduleKey: serviceKey });
  if (!enabled.enabled) {
    await prisma.saUsageEvent.create({
      data: {
        tenantId: args.tenantId,
        serviceKey,
        amount,
        periodType,
        periodKey,
        source: args.source || null,
        meta: { ...(args.meta && typeof args.meta === "object" ? (args.meta as any) : {}), blocked: true, blockReason: enabled.reason }
      } as any
    });
    return {
      blocked: true,
      blockReason: enabled.reason,
      periodType,
      periodKey,
      usageTotal: 0,
      billed: null
    };
  }

  const snap = await prisma.saTenantPlanSnapshot.findFirst({
    where: { tenantId: args.tenantId, active: true },
    orderBy: { startsAt: "desc" }
  });
  if (!snap) throw new Error("tenant_plan_missing");

  const snapshot = (snap.snapshot && typeof snap.snapshot === "object" ? (snap.snapshot as any) : {}) as SnapshotShape;
  const kind = normalizeKind(snapshot.kind) ?? SaPlanKind.MASTER;
  const rule = ruleFromSnapshot(kind, serviceKey, snapshot);

  const res = await prisma.$transaction(async (tx) => {
    const existing = await tx.saUsageCounter.findUnique({
      where: { tenantId_serviceKey_periodKey: { tenantId: args.tenantId, serviceKey, periodKey } }
    });
    const prevTotal = existing?.total ?? 0;
    const nextTotal = prevTotal + amount;

    await tx.saUsageEvent.create({
      data: {
        tenantId: args.tenantId,
        serviceKey,
        amount,
        periodType,
        periodKey,
        source: args.source || null,
        meta: args.meta ?? null
      } as any
    });

    await tx.saUsageCounter.upsert({
      where: { tenantId_serviceKey_periodKey: { tenantId: args.tenantId, serviceKey, periodKey } },
      create: { tenantId: args.tenantId, serviceKey, periodKey, total: amount } as any,
      update: { total: { increment: amount } } as any
    });

    let billed: null | { quantity: number; unitPriceInCents: number; totalInCents: number } = null;

    if (kind === SaPlanKind.ON_DEMAND) {
      const unit = Math.max(0, Math.trunc(rule.unitPriceInCents || 0));
      const totalInCents = unit * amount;
      if (unit > 0 && amount > 0) {
        billed = { quantity: amount, unitPriceInCents: unit, totalInCents };
      }
    } else if (kind === SaPlanKind.PRO) {
      const max = rule.isUnlimited ? null : rule.maxValue;
      const unit = Math.max(0, Math.trunc(rule.unitPriceInCents || 0));
      if (max != null && Number.isFinite(max) && max >= 0 && unit > 0) {
        const overPrev = Math.max(0, prevTotal - max);
        const overNext = Math.max(0, nextTotal - max);
        const overInc = Math.max(0, overNext - overPrev);
        if (overInc > 0) {
          billed = { quantity: overInc, unitPriceInCents: unit, totalInCents: overInc * unit };
        }
      }
    }

    if (billed) {
      await tx.saBillingEvent.create({
        data: {
          tenantId: args.tenantId,
          serviceKey,
          quantity: billed.quantity,
          unitPriceInCents: billed.unitPriceInCents,
          totalInCents: billed.totalInCents,
          periodType,
          periodKey,
          meta: { source: args.source || null, usageAmount: amount }
        } as any
      });

      await tx.saBillingCounter.upsert({
        where: { tenantId_serviceKey_periodKey: { tenantId: args.tenantId, serviceKey, periodKey } },
        create: {
          tenantId: args.tenantId,
          serviceKey,
          periodKey,
          totalQuantity: billed.quantity,
          totalInCents: billed.totalInCents
        } as any,
        update: {
          totalQuantity: { increment: billed.quantity },
          totalInCents: { increment: billed.totalInCents }
        } as any
      });
    }

    return { nextTotal, billed };
  });

  return {
    blocked: false,
    blockReason: null,
    periodType,
    periodKey,
    usageTotal: res.nextTotal,
    billed: res.billed
  };
}
