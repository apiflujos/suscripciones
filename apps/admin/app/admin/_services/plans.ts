import "server-only";

import { prisma } from "@suscripciones/database";
import { LogLevel, PlanIntervalUnit, PlanType } from "@prisma/client";
import { consumeApp } from "@suscripciones/core/services/superAdminApp";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrencyCode } from "@suscripciones/core/lib/currencies";

type PlanCreateResult =
  | { ok: true; plan: any }
  | { ok: false; status: number; error: string; details?: any };

export async function createPlan(args: {
  tenantIds: string[];
  name: string;
  priceInCents: number;
  currency?: string;
  intervalUnit?: PlanIntervalUnit;
  intervalCount?: number;
  collectionMode?: "MANUAL_LINK" | "AUTO_LINK" | "AUTO_DEBIT";
  planType?: PlanType;
  active?: boolean;
  metadata?: any;
}): Promise<PlanCreateResult> {
  const tenantIds = Array.from(new Set((args.tenantIds || []).map((v) => String(v || "").trim()).filter(Boolean)));
  if (!tenantIds.length) return { ok: false, status: 400, error: "tenant_required" };

  const name = String(args.name || "").trim();
  if (!name) return { ok: false, status: 400, error: "invalid_name" };
  const priceInCents = Math.trunc(Number(args.priceInCents || 0));
  if (!Number.isFinite(priceInCents) || priceInCents <= 0) return { ok: false, status: 400, error: "invalid_price" };

  const normalizedCurrency = normalizeCurrencyCode(args.currency || DEFAULT_CURRENCY) || DEFAULT_CURRENCY;
  if (!isSupportedCurrency(normalizedCurrency)) return { ok: false, status: 400, error: "unsupported_currency" };

  const intervalUnit = args.intervalUnit ?? PlanIntervalUnit.MONTH;
  const intervalCountRaw = Number(args.intervalCount ?? 1);
  const intervalCount = Number.isFinite(intervalCountRaw) && intervalCountRaw > 0 ? Math.trunc(intervalCountRaw) : 1;

  const collectionMode = (args.collectionMode || "MANUAL_LINK").toUpperCase() as "MANUAL_LINK" | "AUTO_LINK" | "AUTO_DEBIT";
  const computedPlanType: PlanType = collectionMode === "MANUAL_LINK" ? PlanType.manual_link : PlanType.auto_subscription;
  const effectivePlanType: PlanType = args.planType ?? computedPlanType;
  const finalPlanType: PlanType = collectionMode === "MANUAL_LINK" ? effectivePlanType : PlanType.auto_subscription;

  const mergedMetadata = {
    ...(args.metadata && typeof args.metadata === "object" ? (args.metadata as any) : {}),
    collectionMode
  };

  const plan = await prisma.subscriptionPlan.create({
    data: {
      name,
      priceInCents,
      currency: normalizedCurrency,
      intervalUnit,
      intervalCount,
      planType: finalPlanType,
      ...(typeof args.active === "boolean" ? { active: args.active } : {}),
      tenantId: tenantIds[0],
      metadata: mergedMetadata as any
    }
  });

  await prisma.subscriptionPlanTenant.createMany({
    data: tenantIds.map((t) => ({ planId: plan.id, tenantId: t })),
    skipDuplicates: true
  });
  await consumeApp("plans_created", { amount: 1, source: "admin:plans.create", meta: { planId: plan.id, planType: plan.planType } });
  return { ok: true, plan };
}

export async function updatePlanRecurrence(args: {
  planId: string;
  intervalUnit?: PlanIntervalUnit;
  intervalCount?: number;
  tenantId?: string | null;
}) {
  const id = String(args.planId || "").trim();
  if (!id) return { ok: false, status: 400, error: "invalid_id" as const };

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return { ok: false, status: 404, error: "not_found" as const };
  if ((plan.metadata as any)?.kind === "CATALOG_ITEM") return { ok: false, status: 404, error: "not_found" as const };

  if (args.tenantId) {
    const allowed = plan.tenantId === args.tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "not_found" as const };
  }

  const data: any = {};
  if (args.intervalUnit) data.intervalUnit = args.intervalUnit;
  if (args.intervalCount) {
    const count = Number(args.intervalCount);
    if (Number.isFinite(count) && count > 0) data.intervalCount = Math.trunc(count);
  }
  if (!Object.keys(data).length) return { ok: true, plan };

  const updated = await prisma.subscriptionPlan.update({ where: { id }, data });
  await systemLog(LogLevel.INFO, "plans.update", "Plan updated", { planId: id }).catch(() => {});
  return { ok: true, plan: updated };
}

export async function deletePlan(args: { planId: string; tenantId?: string | null; force?: boolean }) {
  const id = String(args.planId || "").trim();
  if (!id) return { ok: false, status: 400, error: "invalid_id" as const };

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return { ok: false, status: 404, error: "not_found" as const };
  if ((plan.metadata as any)?.kind === "CATALOG_ITEM") return { ok: false, status: 404, error: "not_found" as const };

  if (args.tenantId) {
    const allowed = plan.tenantId === args.tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "not_found" as const };
  }

  const [subscriptionsCount, paymentLinksCount] = await Promise.all([
    prisma.subscription.count({ where: { planId: id } }),
    prisma.paymentLink.count({ where: { planId: id } })
  ]);

  const force = Boolean(args.force);
  if (!force && (subscriptionsCount || paymentLinksCount)) {
    return { ok: false, status: 409, error: "plan_has_dependencies", details: { subscriptionsCount, paymentLinksCount } };
  }

  if (force) {
    const subs = await prisma.subscription.findMany({ where: { planId: id }, select: { id: true } });
    const subIds = subs.map((s: any) => s.id);
    const payments = await prisma.payment.findMany({ where: { subscriptionId: { in: subIds } }, select: { id: true } });
    const paymentIds = payments.map((p: any) => p.id);

    if (paymentIds.length) {
      await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
    }
    await prisma.chatwootMessage.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
    await prisma.paymentLink.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
    await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
    await prisma.subscription.deleteMany({ where: { id: { in: subIds } } }).catch(() => {});
    await prisma.subscriptionPlanTenant.deleteMany({ where: { planId: id } }).catch(() => {});
  }

  await prisma.subscriptionPlan.delete({ where: { id } });
  await systemLog(LogLevel.INFO, "plans.delete", "Plan deleted", { planId: id }).catch(() => {});
  return { ok: true };
}
