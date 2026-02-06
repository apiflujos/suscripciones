import { prisma } from "../db/prisma";
import { SaPeriodType } from "@prisma/client";

function moneyCop(cents: number) {
  const v = Math.trunc(Number(cents || 0) / 100);
  return new Intl.NumberFormat("es-CO").format(Number(v));
}

export async function buildMonthlyBillingReport(args: { periodKey: string }) {
  const periodKey = String(args.periodKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(periodKey)) throw new Error("invalid_period_key");

  const tenants = await prisma.saTenant.findMany({ orderBy: { name: "asc" } });
  const defs = await prisma.saLimitDefinition.findMany({ orderBy: { key: "asc" } });

  const counters = await prisma.saUsageCounter.findMany({
    where: { periodKey: { in: [periodKey, "total"] } }
  });
  const billing = await prisma.saBillingCounter.findMany({
    where: { periodKey: { in: [periodKey, "total"] } }
  });

  const usageBy = new Map<string, number>();
  for (const c of counters) usageBy.set(`${c.tenantId}:${c.serviceKey}:${c.periodKey}`, c.total);

  const billingBy = new Map<string, { q: number; cents: number }>();
  for (const b of billing) billingBy.set(`${b.tenantId}:${b.serviceKey}:${b.periodKey}`, { q: b.totalQuantity, cents: b.totalInCents });

  const items = tenants.map((t) => {
    const services = defs.map((d) => {
      const pk = d.periodType === SaPeriodType.total ? "total" : periodKey;
      const u = usageBy.get(`${t.id}:${d.key}:${pk}`) ?? 0;
      const b = billingBy.get(`${t.id}:${d.key}:${pk}`) ?? { q: 0, cents: 0 };
      return { key: d.key, name: d.name, periodType: d.periodType, periodKey: pk, usageTotal: u, billedQuantity: b.q, billedInCents: b.cents };
    });
    const billedInCents = services.reduce((acc, s) => acc + s.billedInCents, 0);
    return { tenantId: t.id, tenantName: t.name, services, totals: { billedInCents } };
  });

  const grand = {
    billedInCents: items.reduce((acc, x) => acc + x.totals.billedInCents, 0)
  };

  const lines: string[] = [];
  lines.push(`Reporte mensual SaaS — periodo ${periodKey} (UTC)`);
  lines.push(`Tenants: ${tenants.length}`);
  lines.push(`Total cobrado: $${moneyCop(grand.billedInCents)} COP`);
  lines.push("");

  for (const t of items) {
    lines.push(`Tenant: ${t.tenantName} (${t.tenantId})`);
    lines.push(`Cobrado: $${moneyCop(t.totals.billedInCents)} COP`);
    for (const s of t.services) {
      const billed = s.billedInCents ? `$${moneyCop(s.billedInCents)} COP` : "$0 COP";
      lines.push(`- ${s.key} · uso=${s.usageTotal} · cobro=${billed}`);
    }
    lines.push("");
  }

  return {
    periodKey,
    totals: grand,
    tenants: items,
    text: lines.join("\n")
  };
}

