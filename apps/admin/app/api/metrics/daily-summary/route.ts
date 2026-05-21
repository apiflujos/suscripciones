import { NextResponse } from "next/server";
import { BillingCycleStatus, PaymentStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@suscripciones/database";
import { requireApiSession } from "../../_lib/requireApiSession";
import { getMetricsOverviewCached } from "../../../admin/_services/metrics";
import { listSubscriptions } from "../../../admin/_services/subscriptionQueries";
import { listTenants } from "../../../admin/_services/tenants";
import { resolveTenantId } from "../../../admin/_services/tenantResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

type Period = "day" | "week" | "month";

function parseDay(value: string | null) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date(Date.now() - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

function parsePeriod(value: string | null): Period {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "week" || raw === "month" ? raw : "day";
}

function bogotaPeriodToUtcRange(day: string, period: Period) {
  const [year, month, date] = day.split("-").map((part) => Number(part));
  const selected = new Date(Date.UTC(year, month - 1, date, 5, 0, 0, 0));
  let from = selected;
  let to = new Date(from.getTime() + DAY_MS);
  if (period === "week") {
    const bogotaNoon = new Date(Date.UTC(year, month - 1, date, 17, 0, 0, 0));
    const dayOfWeek = bogotaNoon.getUTCDay() || 7;
    from = new Date(selected.getTime() - (dayOfWeek - 1) * DAY_MS);
    to = new Date(from.getTime() + 7 * DAY_MS);
  }
  if (period === "month") {
    from = new Date(Date.UTC(year, month - 1, 1, 5, 0, 0, 0));
    to = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 5, 0, 0, 0));
  }
  return { from, to };
}

function money(cents: unknown) {
  const value = Math.trunc(Number(cents || 0) / 100);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(value);
}

function pct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0,0%";
  return `${n.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%`;
}

function int(value: unknown) {
  return new Intl.NumberFormat("es-CO").format(Math.trunc(Number(value || 0)));
}

function shortDate(value: Date) {
  return value.toLocaleDateString("es-CO", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
}

function periodLabel(period: Period) {
  if (period === "week") return "semana";
  if (period === "month") return "mes";
  return "dia";
}

function customerLine(item: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  product?: string | null;
  amountInCents?: number | null;
  date?: Date | string | null;
  status?: string | null;
}) {
  const contact = [item.email, item.phone].map((value) => String(value || "").trim()).filter(Boolean).join(" / ");
  const details = [
    item.product ? `Producto: ${item.product}` : "",
    item.amountInCents != null ? `Valor: ${money(item.amountInCents)}` : "",
    item.date ? `Fecha: ${shortDate(new Date(item.date))}` : "",
    item.status ? `Estado: ${item.status}` : ""
  ].filter(Boolean).join(" - ");
  return `${item.name || "Cliente sin nombre"}${contact ? ` (${contact})` : ""}${details ? ` - ${details}` : ""}`;
}

function collectionStatusLabel(subscription: any, asOf: Date) {
  if (subscription?.collectionCyclePaid) return "Al dia";
  const dueAt = subscription?.nextBillingDate ? new Date(subscription.nextBillingDate) : null;
  const status = String(subscription?.status || "").toUpperCase();
  if (!dueAt || Number.isNaN(dueAt.getTime())) return status === "PAST_DUE" || status === "EXPIRED" ? "En mora" : "Al dia";
  const graceDays = Number.isFinite(Number(subscription?.graceDays)) ? Math.max(0, Math.trunc(Number(subscription.graceDays))) : 5;
  if (asOf.getTime() <= dueAt.getTime()) return "Al dia";
  const daysLate = Math.ceil((asOf.getTime() - dueAt.getTime()) / DAY_MS);
  return daysLate <= graceDays ? "En gracia" : "En mora";
}

function buildText(args: {
  day: string;
  period: Period;
  from: Date;
  to: Date;
  tenantLabel: string;
  metrics: any;
  prevMetrics: any;
  subscriptions: any[];
  paidCustomers: Array<ReturnType<typeof customerLine>>;
  unpaidCustomers: Array<ReturnType<typeof customerLine>>;
  generatedAt: Date;
}) {
  const totals = args.metrics?.totals || {};
  const prevTotals = args.prevMetrics?.totals || {};
  const ok = Number(totals.totalPaymentsSuccessful || 0);
  const fail = Number(totals.totalPaymentsFailed || 0);
  const totalPayments = ok + fail;
  const approval = totalPayments > 0 ? (ok / totalPayments) * 100 : 0;
  const prevRevenue = Number(prevTotals.totalRevenueInCents || 0);
  const revenue = Number(totals.totalRevenueInCents || 0);
  const revenueDelta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;
  const linksSent = Number(totals?.link?.linksSent || totals?.totalPaymentLinksSent || 0);
  const linksPaid = Number(totals?.link?.linksPaid || 0);
  const linkConversion = totals?.link?.conversionLinkToPayPct ?? (linksSent > 0 ? (linksPaid / linksSent) * 100 : null);
  const active = Number(totals.totalActiveSubscriptions || 0);
  const autoMrr = Number(totals?.auto?.mrrInCents || 0);
  const autoOk = Number(totals?.auto?.autoChargesSuccessful || 0);
  const autoFail = Number(totals?.auto?.autoChargesFailed || 0);
  const asOf = new Date(`${args.day}T23:59:59.000-05:00`);
  const statusCounts = args.subscriptions.reduce(
    (acc, sub) => {
      const label = collectionStatusLabel(sub, asOf);
      if (label === "En mora") acc.overdue += 1;
      else if (label === "En gracia") acc.grace += 1;
      else acc.healthy += 1;
      return acc;
    },
    { healthy: 0, grace: 0, overdue: 0 }
  );
  const topProducts = Array.isArray(args.metrics?.breakdown?.revenueByProduct)
    ? args.metrics.breakdown.revenueByProduct.slice(0, 3)
    : [];
  const alerts = [
    statusCounts.overdue > 0 ? `Cobrar o revisar ${int(statusCounts.overdue)} suscripciones en mora.` : "",
    fail > 0 ? `Revisar ${int(fail)} pagos fallidos del dia.` : "",
    linksSent > 0 && Number(linkConversion || 0) < 30 ? "Conversion de links baja: revisar plantilla y seguimiento." : "",
    autoFail > 0 ? `Revisar ${int(autoFail)} cobros automaticos fallidos.` : ""
  ].filter(Boolean);

  const title = `Resumen operativo del ${periodLabel(args.period)} - ${shortDate(args.from)} a ${shortDate(new Date(args.to.getTime() - 1))}`;
  return [
    title,
    `Canal: ${args.tenantLabel}`,
    `Generado: ${args.generatedAt.toLocaleString("es-CO", { timeZone: "America/Bogota" })}`,
    "",
    "Indicadores",
    `- Ingresos aprobados: ${money(revenue)}${revenueDelta == null ? "" : ` (${revenueDelta >= 0 ? "+" : ""}${pct(revenueDelta)} vs periodo anterior)`}`,
    `- Pagos: ${int(ok)} aprobados / ${int(fail)} fallidos (${pct(approval)} aprobacion).`,
    `- Links de pago: ${int(linksSent)} enviados / ${int(linksPaid)} pagados (${linkConversion == null ? "sin actividad" : pct(linkConversion)} conversion).`,
    `- Suscripciones activas: ${int(active)}. MRR auto: ${money(autoMrr)}.`,
    `- Cobros automaticos: ${int(autoOk)} exitosos / ${int(autoFail)} fallidos.`,
    `- Clientes que pagaron: ${int(args.paidCustomers.length)}.`,
    `- Clientes que no pagaron vencimientos del periodo: ${int(args.unpaidCustomers.length)}.`,
    "",
    "Quien pago",
    ...(args.paidCustomers.length
      ? args.paidCustomers.slice(0, 40).map((line) => `- ${line}`)
      : ["- No hay pagos aprobados en el periodo."]),
    ...(args.paidCustomers.length > 40 ? [`- Y ${int(args.paidCustomers.length - 40)} pagos mas.`] : []),
    "",
    "Quien no pago",
    ...(args.unpaidCustomers.length
      ? args.unpaidCustomers.slice(0, 40).map((line) => `- ${line}`)
      : ["- No hay vencimientos pendientes del periodo."]),
    ...(args.unpaidCustomers.length > 40 ? [`- Y ${int(args.unpaidCustomers.length - 40)} pendientes mas.`] : []),
    "",
    "Estado de cartera",
    `- Al dia: ${int(statusCounts.healthy)}`,
    `- En gracia: ${int(statusCounts.grace)}`,
    `- En mora: ${int(statusCounts.overdue)}`,
    "",
    "Productos principales",
    ...(topProducts.length
      ? topProducts.map((item: any, idx: number) => `- ${idx + 1}. ${String(item?.productName || "Producto")}: ${money(item?.revenueInCents || 0)} (${int(item?.paymentsSuccess || 0)} pagos OK)`)
      : ["- Sin ventas por producto en el dia."]),
    "",
    "Acciones sugeridas",
    ...(alerts.length ? alerts.map((line) => `- ${line}`) : ["- Sin alertas criticas para este dia."])
  ].join("\n");
}

export async function GET(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const day = parseDay(url.searchParams.get("date"));
  const period = parsePeriod(url.searchParams.get("period"));
  const tenantParam = String(url.searchParams.get("tenantId") || "").trim();
  const tenantId = tenantParam ? await resolveTenantId(tenantParam) : auth.session.tenantId || null;
  const { from, to } = bogotaPeriodToUtcRange(day, period);
  const rangeMs = Math.max(DAY_MS, to.getTime() - from.getTime());
  const prevFrom = new Date(from.getTime() - rangeMs);
  const prevTo = from;

  const tenantWhere = tenantId
    ? { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] }
    : {};
  const [metrics, prevMetrics, subscriptions, paidPayments, unpaidCycles, tenants] = await Promise.all([
    getMetricsOverviewCached({ from, to, granularity: period, tenantId }),
    getMetricsOverviewCached({ from: prevFrom, to: prevTo, granularity: period, tenantId }),
    listSubscriptions({ take: 500, tenantId: tenantId || undefined }),
    prisma.payment.findMany({
      where: {
        status: PaymentStatus.APPROVED,
        paidAt: { gte: from, lt: to },
        ...(tenantId ? { tenantId } : {})
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      take: 500,
      include: {
        customer: { select: { name: true, email: true, phone: true } },
        subscription: { select: { plan: { select: { name: true } }, product: { select: { name: true } } } }
      }
    }),
    prisma.subscriptionBillingCycle.findMany({
      where: {
        dueAt: { gte: from, lt: to },
        status: { not: BillingCycleStatus.PAID },
        subscription: {
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED] },
          ...tenantWhere
        }
      },
      orderBy: [{ dueAt: "asc" }],
      take: 500,
      include: {
        subscription: {
          select: {
            plan: { select: { name: true, priceInCents: true } },
            product: { select: { name: true } },
            customer: { select: { name: true, email: true, phone: true } }
          }
        }
      }
    }),
    listTenants()
  ]);

  if (!metrics.ok) {
    return Response.json({ error: metrics.error, message: metrics.message || "No se pudo generar el resumen diario." }, { status: metrics.status });
  }

  const tenantLabel = tenantId ? tenants.find((tenant: any) => String(tenant.id) === String(tenantId))?.name || "Canal" : "Todos";
  const paidCustomers = paidPayments.map((payment) =>
    customerLine({
      name: payment.customer?.name,
      email: payment.customer?.email,
      phone: payment.customer?.phone,
      product: payment.subscription?.product?.name || payment.subscription?.plan?.name || null,
      amountInCents: payment.amountInCents,
      date: payment.paidAt,
      status: "Pagado"
    })
  );
  const unpaidCustomers = unpaidCycles.map((cycle) =>
    customerLine({
      name: cycle.subscription.customer?.name,
      email: cycle.subscription.customer?.email,
      phone: cycle.subscription.customer?.phone,
      product: cycle.subscription.product?.name || cycle.subscription.plan?.name || null,
      amountInCents: cycle.subscription.plan?.priceInCents ?? null,
      date: cycle.dueAt,
      status: String(cycle.status || "PENDING")
    })
  );
  const text = buildText({
    day,
    period,
    from,
    to,
    tenantLabel,
    metrics: metrics.data,
    prevMetrics: prevMetrics.ok ? prevMetrics.data : null,
    subscriptions: subscriptions.items || [],
    paidCustomers,
    unpaidCustomers,
    generatedAt: new Date()
  });
  const filename = `resumen-${periodLabel(period)}-${day}${tenantId ? `-${tenantId.slice(0, 8)}` : ""}.txt`;

  return new NextResponse(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
}
