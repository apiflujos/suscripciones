import { listTenants } from "./admin/_services/tenants";
import { getMetricsOverviewCached } from "./admin/_services/metrics";
import { getSubscriptionsBoard } from "./admin/_services/subscriptionsBoard";
import { getScheduledJobsReport } from "./admin/_services/scheduledJobsReport";
import { listPaymentLogs } from "./admin/_services/logs";
import { listSubscriptions } from "./admin/_services/subscriptions";
import { getAdminSettings } from "./admin/_services/settings";
import { countEmpresasAndContactos } from "./admin/_services/companies";
import { resolveTenantId } from "./admin/_services/tenantResolver";
import { MetricsFilters } from "./ui/MetricsFilters";
import { PageToolbar } from "./ui/PageToolbar";
import { CollectionSummary } from "./ui/CollectionSummary";
import { ScheduledJobsPanel } from "./ui/ScheduledJobsReport";
import { AiAssistant } from "./logs/AiAssistant";
import {
  alignSeries,
  avg,
  fmtBucketLabel,
  fmtDelta,
  fmtDeltaPp,
  fmtMoneyCop,
  fmtPct,
  fmtShortDate,
  isoDateFromTimestamp,
  isoDateUtc,
  pctChange,
  sum,
  toUtcIsoEndExclusive,
  toUtcIsoStart
} from "./lib/metricsFormat";

function ChartLines({
  series,
  labels,
  tooltipLabel,
  height = 120
}: {
  series: Array<{ values: number[]; label: string; color?: string; dashed?: boolean }>;
  labels?: string[];
  tooltipLabel?: (value: number, index: number, seriesLabel: string) => string;
  height?: number;
}) {
  const w = 520;
  const h = height;
  const pad = 10;
  const colors = ["var(--chart-a)", "var(--chart-b)", "var(--chart-c)"];
  const allValues = series.flatMap((s) => s.values.map((v) => (Number.isFinite(v) ? v : 0)));
  const max = Math.max(1, ...allValues);
  const gridCount = 4;
  const fmtAxis = (v: number) => new Intl.NumberFormat("es-CO").format(Math.round(v));
  const labelIdxs = labels?.length
    ? labels.length > 1
      ? Array.from(new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1]))
      : [0]
    : [];
  const step = labels?.length ? Math.max(1, Math.ceil(labels.length / 12)) : 1;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden="true">
        {Array.from({ length: gridCount + 1 }).map((_, i) => {
          const y = pad + (i * (h - pad * 2)) / gridCount;
          const value = max - (i * max) / gridCount;
          const showLabel = i === 0 || i === Math.floor(gridCount / 2) || i === gridCount;
          return (
            <g key={`grid-${i}`}>
              <line x1="0" y1={y} x2={w} y2={y} stroke="var(--chart-track)" />
              {showLabel ? (
                <text x={2} y={y - 2} fontSize="9" fill="var(--text-faint)">
                  {fmtAxis(value)}
                </text>
              ) : null}
            </g>
          );
        })}
        {series.map((s, si) => {
          const color = s.color || colors[si % colors.length];
          const pts = s.values.map((v, i) => {
            const x = pad + (i * (w - pad * 2)) / Math.max(1, s.values.length - 1);
            const y = h - pad - (Math.max(0, v) * (h - pad * 2)) / max;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          });
          return (
            <g key={`series-${s.label}-${si}`}>
              <polyline
                points={pts.join(" ")}
                fill="none"
                stroke={color}
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "6 4" : undefined}
              />
              {s.values.map((v, i) => {
                if (i % step !== 0 && i !== s.values.length - 1) return null;
                const x = pad + (i * (w - pad * 2)) / Math.max(1, s.values.length - 1);
                const y = h - pad - (Math.max(0, v) * (h - pad * 2)) / max;
                const tip = tooltipLabel ? tooltipLabel(v, i, s.label) : `${labels?.[i] || ""} · ${s.label}: ${v}`;
                return (
                  <g key={`pt-${si}-${i}`}>
                    <circle cx={x} cy={y} r="2.5" fill={color} />
                    <title>{tip}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
        <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="var(--chart-axis)" />
        {labels
          ? labelIdxs.map((i) => {
              const x = pad + (i * (w - pad * 2)) / Math.max(1, labels.length - 1);
              const textAnchor = i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle";
              return (
                <text key={`label-${i}`} x={x} y={h - 2} textAnchor={textAnchor} fontSize="10" fill="var(--text-faint)">
                  {labels[i] || ""}
                </text>
              );
            })
          : null}
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--muted)", fontSize: 12 }}>
        {series.map((s, i) => {
          const color = s.color || colors[i % colors.length];
          return (
            <span key={`legend-${s.label}-${i}`}>
              <span style={{ display: "inline-block", width: 10, height: 10, background: color, borderRadius: 3, marginRight: 6 }} /> {s.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ChartBars({
  a,
  b,
  aLabel,
  bLabel,
  labels,
  height = 120
}: {
  a: number[];
  b: number[];
  aLabel: string;
  bLabel: string;
  labels?: string[];
  height?: number;
}) {
  const w = 520;
  const h = height;
  const pad = 10;
  // FIX: Manejar valores negativos correctamente
  const min = Math.min(0, ...a, ...b);
  const max = Math.max(1, ...a, ...b);
  const range = max - min;
  const gridCount = 4;
  const fmtAxis = (v: number) => new Intl.NumberFormat("es-CO").format(Math.round(v));
  const n = Math.max(a.length, b.length);
  const gap = 6;
  const groupW = (w - pad * 2) / Math.max(1, n);
  const barW = Math.max(2, (groupW - gap) / 2);
  
  // Calcular línea base (zero line) proporcionalmente
  const zeroY = min < 0 ? pad + ((0 - min) / range) * (h - pad * 2) : h - pad;
  
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden="true">
        {Array.from({ length: gridCount + 1 }).map((_, i) => {
          const y = pad + (i * (h - pad * 2)) / gridCount;
          // FIX: Mostrar valores correctos en el eje Y considerando negativos
          const value = max - (i * range) / gridCount;
          const showLabel = i === 0 || i === Math.floor(gridCount / 2) || i === gridCount;
          return (
            <g key={`grid-${i}`}>
              <line x1="0" y1={y} x2={w} y2={y} stroke="var(--chart-track)" />
              {showLabel ? (
                <text x={2} y={y - 2} fontSize="9" fill="var(--text-faint)">
                  {fmtAxis(value)}
                </text>
              ) : null}
            </g>
          );
        })}
        {/* Línea de cero cuando hay valores negativos */}
        {min < 0 && (
          <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="var(--chart-axis)" strokeWidth="1.5" strokeDasharray="4 2" />
        )}
        {Array.from({ length: n }).map((_, i) => {
          const x0 = pad + i * groupW;
          const va = a[i] ?? 0;
          const vb = b[i] ?? 0;
          
          // FIX: Calcular altura y posición correctamente para valores negativos
          const ha = range > 0 ? (Math.abs(va) * (h - pad * 2)) / range : 0;
          const hb = range > 0 ? (Math.abs(vb) * (h - pad * 2)) / range : 0;
          
          // FIX: Posición Y correcta dependiendo del signo
          const ya = va >= 0 ? h - pad - ha : zeroY;
          const yb = vb >= 0 ? h - pad - hb : zeroY;
          
          return (
            <g key={i}>
              <rect 
                x={x0} 
                y={ya} 
                width={barW} 
                height={ha} 
                fill={va < 0 ? "var(--danger)" : "var(--chart-a)"} 
                rx="3"
              >
                <title>{`${labels?.[i] || ""} · ${aLabel}: ${va}`}</title>
              </rect>
              <rect 
                x={x0 + barW + gap} 
                y={yb} 
                width={barW} 
                height={hb} 
                fill={vb < 0 ? "var(--danger)" : "var(--chart-b)"} 
                rx="3"
              >
                <title>{`${labels?.[i] || ""} · ${bLabel}: ${vb}`}</title>
              </rect>
            </g>
          );
        })}
        <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="var(--chart-axis)" />
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--muted)", fontSize: 12 }}>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--chart-a)", borderRadius: 2, marginRight: 6 }} />{" "}
          {aLabel}
        </span>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--chart-b)", borderRadius: 2, marginRight: 6 }} />{" "}
          {bLabel}
        </span>
      </div>
    </div>
  );
}

export default async function Home({
  searchParams
}: {
  searchParams?: Promise<{ from?: string; to?: string; g?: string; tenantId?: string }>;
}) {
  const now = new Date();
  const defaultTo = isoDateUtc(now);
  const defaultFrom = isoDateUtc(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));

  const sp = (await searchParams) ?? {};
  const g = (sp.g === "week" || sp.g === "month" ? sp.g : "day") as "day" | "week" | "month";
  const fromDate = sp.from || defaultFrom;
  const toDate = sp.to || defaultTo;
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const fromIso = toUtcIsoStart(fromDate) || toUtcIsoStart(defaultFrom)!;
  const toIso = toUtcIsoEndExclusive(toDate) || toUtcIsoEndExclusive(defaultTo)!;
  const periodLabel = g === "day" ? "Diario" : g === "week" ? "Semanal" : "Mensual";
  const rangeLabel = `${fmtShortDate(fromDate)} → ${fmtShortDate(toDate)}`;

  const resolvedTenantId = tenantId ? await resolveTenantId(tenantId) : null;
  const tenants = await listTenants();
  const tenantLabel = tenantId ? (tenants.find((t: any) => String(t.id) === String(tenantId))?.name || "Canal") : "Todos";

  const baseParams = new URLSearchParams({
    from: fromDate,
    to: toDate,
    g,
    ...(tenantId ? { tenantId } : {})
  });
  const dailySummaryParams = new URLSearchParams({
    date: toDate,
    period: g,
    ...(tenantId ? { tenantId } : {})
  });
  const dailySummaryHref = `/api/metrics/daily-summary?${dailySummaryParams.toString()}`;

  const periodMs = Math.max(24 * 60 * 60 * 1000, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const prevFromIso = new Date(new Date(fromIso).getTime() - periodMs).toISOString();
  const prevToIso = new Date(fromIso).toISOString();
  // La configuración manda sobre el tablero: los días de gracia y los permisos
  // de cobro manual salen de ahí, así que se lee antes que el resto.
  const settingsRes = await getAdminSettings();
  const graceDays = Number(settingsRes?.autoDebit?.graceDays ?? 5);

  const [metrics, prevMetrics, paymentsRes, subscriptionsRes, companiesCount, subscriptionsBoard, jobsReport] =
    await Promise.all([
      getMetricsOverviewCached({ from: fromIso, to: toIso, granularity: g, tenantId: resolvedTenantId || undefined }),
      getMetricsOverviewCached({ from: prevFromIso, to: prevToIso, granularity: g, tenantId: resolvedTenantId || undefined }),
      listPaymentLogs({ take: 6, status: "APPROVED", tenantId: resolvedTenantId || undefined }),
      listSubscriptions({ take: 500, tenantId: resolvedTenantId || undefined }),
      countEmpresasAndContactos(resolvedTenantId || null),
      getSubscriptionsBoard({ tenantId: resolvedTenantId || null, graceDays }),
      getScheduledJobsReport()
    ]);

  const aiConfig = settingsRes?.ai || null;
  const aiProviders = aiConfig?.providers || null;
  const aiEnabled = Boolean(aiConfig?.enabled && (aiProviders?.openai?.configured || aiProviders?.deepseek?.configured));
  const metricsData = metrics.ok ? metrics.data : null;
  const prevMetricsData = prevMetrics.ok ? prevMetrics.data : null;
  const series: any[] = metricsData?.series || [];
  const prevSeries: any[] = prevMetricsData?.series || [];
  const revenueSeries = series.map((p) => Number(p?.revenueInCents ?? 0));
  const prevRevenueSeries = alignSeries(prevSeries.map((p) => Number(p?.revenueInCents ?? 0)), revenueSeries.length);
  const okSeries = series.map((p) => Number(p?.paymentsSuccess ?? 0));
  const failSeries = series.map((p) => Number(p?.paymentsFailed ?? 0));
  const prevOkSeries = alignSeries(prevSeries.map((p) => Number(p?.paymentsSuccess ?? 0)), okSeries.length);
  const prevFailSeries = alignSeries(prevSeries.map((p) => Number(p?.paymentsFailed ?? 0)), okSeries.length);
  const linksSent = series.map((p) => Number(p?.linksSent ?? 0));
  const linksPaid = series.map((p) => Number(p?.linksPaid ?? 0));
  const prevLinksSent = alignSeries(prevSeries.map((p) => Number(p?.linksSent ?? 0)), linksSent.length);
  const prevLinksPaid = alignSeries(prevSeries.map((p) => Number(p?.linksPaid ?? 0)), linksPaid.length);
  const activeSubs = series.map((p) => Number(p?.activeSubscriptions ?? 0));
  const prevActiveSubs = alignSeries(prevSeries.map((p) => Number(p?.activeSubscriptions ?? 0)), activeSubs.length);
  const mrrSeries = series.map((p) => (p?.mrrInCents == null ? null : Number(p.mrrInCents)));
  const prevMrrSeries = alignSeries(prevSeries.map((p) => Number(p?.mrrInCents ?? 0)), mrrSeries.length);
  const bucketLabels = series.map((p) => fmtBucketLabel(String(p?.at || ""), g));
  const approvalRateSeries = okSeries.map((ok, i) => {
    const total = ok + (failSeries[i] ?? 0);
    return total > 0 ? (ok / total) * 100 : 0;
  });
  const prevApprovalRateSeries = prevOkSeries.map((ok, i) => {
    const total = ok + (prevFailSeries[i] ?? 0);
    return total > 0 ? (ok / total) * 100 : 0;
  });
  const linkConversionSeries = linksSent.map((sent, i) => {
    const paid = linksPaid[i] ?? 0;
    return sent > 0 ? (paid / sent) * 100 : 0;
  });
  const prevLinkConversionSeries = prevLinksSent.map((sent, i) => {
    const paid = prevLinksPaid[i] ?? 0;
    return sent > 0 ? (paid / sent) * 100 : 0;
  });

  const totalRevenue = Number(metricsData?.totals?.totalRevenueInCents || 0);
  const totalPaymentsOk = Number(metricsData?.totals?.totalPaymentsSuccessful || 0);
  const totalPaymentsFail = Number(metricsData?.totals?.totalPaymentsFailed || 0);
  const totalPayments = totalPaymentsOk + totalPaymentsFail;
  const approvalPct = totalPayments > 0 ? (totalPaymentsOk / totalPayments) * 100 : 0;
  const avgTicket = totalPaymentsOk > 0 ? Math.round(totalRevenue / totalPaymentsOk) : 0;
  const totalActiveSubscriptions = Number(metricsData?.totals?.totalActiveSubscriptions || 0);
  const totalEmpresas = Number(companiesCount?.empresas || 0);
  const totalContactos = Number(companiesCount?.contactos || 0);
  const linkConversionPctRaw = metricsData?.totals?.link?.conversionLinkToPayPct ?? null;
  const autoMrr = Number(metricsData?.totals?.auto?.mrrInCents || 0);
  const autoActive = Number(metricsData?.totals?.auto?.activeSubscriptions || 0);
  const autoNew = Number(metricsData?.totals?.auto?.newSubscriptions || 0);
  const autoCancels = Number(metricsData?.totals?.auto?.cancellations || 0);
  const autoNet = autoNew - autoCancels;
  const autoOk = Number(metricsData?.totals?.auto?.autoChargesSuccessful || 0);
  const autoFail = Number(metricsData?.totals?.auto?.autoChargesFailed || 0);
  const autoTotal = autoOk + autoFail;
  const autoApprovalPct = autoTotal > 0 ? (autoOk / autoTotal) * 100 : 0;
  const autoChurn = metricsData?.totals?.auto?.churnMonthlyPct ?? null;
  // Qué parte de lo que se esperaba cobrar este ciclo está cobrado. Sin esto, un
  // mes en el que no se cobró nada se ve igual que uno normal.
  const esperadoCiclo = Number(subscriptionsBoard.totals.expectedInCents || 0);
  const tasaCobroPct = esperadoCiclo > 0
    ? (Number(subscriptionsBoard.totals.collectedInCents || 0) / esperadoCiclo) * 100
    : null;
  
  // Pagos sin suscripción (one-time, huérfanos, links manuales)
  const unlinkedPaymentsApproved = Number(metricsData?.totals?.unlinked?.paymentsApproved || 0);
  const unlinkedPaymentsOther = Number(metricsData?.totals?.unlinked?.paymentsOther || 0);
  const unlinkedPaymentsTotal = unlinkedPaymentsApproved + unlinkedPaymentsOther;
  const unlinkedRevenue = Number(metricsData?.totals?.unlinked?.revenueInCents || 0);

  
  const recentPayments = paymentsRes.items || [];
  const subscriptionRows = subscriptionsRes.items || [];
  const modeLabel = (s: any) => {
    const mode = String(s?.metadata?.collectionMode || s?.plan?.metadata?.collectionMode || "MANUAL_LINK").toUpperCase();
    if (mode === "AUTO_DEBIT") return "Débito automático";
    if (mode === "AUTO_LINK") return "Link de pago";
    return "Manual";
  };
  const collectionStatusLabel = (s: any) => {
    if (s?.collectionCyclePaid) return "Al día";
    const dueAtTs = s?.nextBillingDate ? new Date(s.nextBillingDate).getTime() : NaN;
    const graceDays = Number.isFinite(Number(s?.graceDays)) ? Math.max(0, Math.trunc(Number(s.graceDays))) : 5;
    if (!Number.isFinite(dueAtTs)) {
      const up = String(s?.status || "").toUpperCase();
      return up === "PAST_DUE" || up === "EXPIRED" ? "En mora" : "Al día";
    }
    const nowTs = now.getTime();
    if (nowTs <= dueAtTs) return "Al día";
    const daysLate = Math.ceil((nowTs - dueAtTs) / (24 * 60 * 60 * 1000));
    if (daysLate <= graceDays) return "En gracia";
    return "En mora";
  };
  const overdueSubs = subscriptionRows.filter((s: any) => collectionStatusLabel(s) === "En mora");
  const graceSubs = subscriptionRows.filter((s: any) => collectionStatusLabel(s) === "En gracia");
  const healthySubs = subscriptionRows.filter((s: any) => collectionStatusLabel(s) === "Al día");
  const contactsPastDue = overdueSubs.length;
  const contactsOnTime = healthySubs.length;

  const revenueTotalSeries = sum(revenueSeries);
  const revenueAvgSeries = avg(revenueSeries);
  const revenueLast = revenueSeries[revenueSeries.length - 1] ?? 0;
  const revenueMax = Math.max(0, ...revenueSeries);

  const okTotalSeries = sum(okSeries);
  const failTotalSeries = sum(failSeries);
  const successRateSeries = okTotalSeries + failTotalSeries > 0 ? (okTotalSeries / (okTotalSeries + failTotalSeries)) * 100 : 0;
  const linksSentTotal = sum(linksSent);
  const linksPaidTotal = sum(linksPaid);
  const hasLinkActivity = linksSentTotal > 0 || linksPaidTotal > 0;
  const linkConversionPct = hasLinkActivity && linkConversionPctRaw != null ? Number(linkConversionPctRaw) : null;
  const activeStart = activeSubs[0] ?? 0;
  const activeEnd = activeSubs[activeSubs.length - 1] ?? 0;
  const activeDelta = activeEnd - activeStart;
  const activeDeltaPct = activeStart > 0 ? (activeDelta / activeStart) * 100 : null;
  const approvalRateAvg = avg(approvalRateSeries);
  const approvalRateLast = approvalRateSeries[approvalRateSeries.length - 1] ?? 0;
  const approvalRateMax = Math.max(0, ...approvalRateSeries);
  const linkConversionAvg = hasLinkActivity ? avg(linkConversionSeries) : null;
  const linkConversionLast = hasLinkActivity ? (linkConversionSeries[linkConversionSeries.length - 1] ?? 0) : null;
  const linkConversionMax = hasLinkActivity ? Math.max(0, ...linkConversionSeries) : null;

  const revenueLink = Number(metricsData?.breakdown?.revenueByPlanTypeInCents?.manual_link || 0);
  const revenueAuto = Number(metricsData?.breakdown?.revenueByPlanTypeInCents?.auto_subscription || 0);
  const revenueByTypeTotal = revenueLink + revenueAuto;
  const revenueLinkPct = revenueByTypeTotal > 0 ? (revenueLink / revenueByTypeTotal) * 100 : 0;
  const revenueAutoPct = revenueByTypeTotal > 0 ? (revenueAuto / revenueByTypeTotal) * 100 : 0;
  const topRevenueProducts = Array.isArray(metricsData?.breakdown?.revenueByProduct) ? metricsData.breakdown.revenueByProduct : [];
  const topPaymentProducts = Array.isArray(metricsData?.breakdown?.paymentActivityByProduct) ? metricsData.breakdown.paymentActivityByProduct : [];
  const topLinkProducts = Array.isArray(metricsData?.breakdown?.linkActivityByProduct) ? metricsData.breakdown.linkActivityByProduct : [];

  const prevTotals = prevMetricsData?.totals || {};
  const hasPrev = prevMetrics.ok;
  const prevRevenue = Number(prevTotals?.totalRevenueInCents || 0);
  const prevPaymentsOk = Number(prevTotals?.totalPaymentsSuccessful || 0);
  const prevPaymentsFail = Number(prevTotals?.totalPaymentsFailed || 0);
  const prevPaymentsTotal = prevPaymentsOk + prevPaymentsFail;
  const prevApprovalPct = prevPaymentsTotal > 0 ? (prevPaymentsOk / prevPaymentsTotal) * 100 : 0;
  const prevLinkConversionRaw = prevTotals?.link?.conversionLinkToPayPct ?? null;
  const prevLinksSentTotal = sum(prevLinksSent);
  const prevLinksPaidTotal = sum(prevLinksPaid);
  const prevHasLinkActivity = prevLinksSentTotal > 0 || prevLinksPaidTotal > 0;
  const prevAutoActive = Number(prevTotals?.auto?.activeSubscriptions || 0);
  const prevAutoNew = Number(prevTotals?.auto?.newSubscriptions || 0);
  const prevAutoCancels = Number(prevTotals?.auto?.cancellations || 0);
  const prevAutoNet = prevAutoNew - prevAutoCancels;
  const prevAutoOk = Number(prevTotals?.auto?.autoChargesSuccessful || 0);
  const prevAutoFail = Number(prevTotals?.auto?.autoChargesFailed || 0);
  const prevAutoTotal = prevAutoOk + prevAutoFail;
  const prevAutoApprovalPct = prevAutoTotal > 0 ? (prevAutoOk / prevAutoTotal) * 100 : 0;
  const prevAutoMrr = Number(prevTotals?.auto?.mrrInCents || 0);
  const prevAutoChurn = prevTotals?.auto?.churnMonthlyPct ?? null;

  const revenueDeltaPct = hasPrev ? pctChange(totalRevenue, prevRevenue) : null;
  const approvalDeltaPp = hasPrev ? approvalPct - prevApprovalPct : null;
  const linkConversionDeltaPp =
    hasPrev && linkConversionPct != null && prevLinkConversionRaw != null && prevHasLinkActivity
      ? linkConversionPct - Number(prevLinkConversionRaw)
      : null;
  const autoActiveDelta = hasPrev ? autoActive - prevAutoActive : null;
  const autoActiveDeltaPct = hasPrev ? pctChange(autoActive, prevAutoActive) : null;
  const autoNetDelta = hasPrev ? autoNet - prevAutoNet : null;
  const autoApprovalDeltaPp = hasPrev ? autoApprovalPct - prevAutoApprovalPct : null;
  const hasAutoActivity = autoActive > 0 || autoMrr > 0 || autoNew > 0 || autoCancels > 0;
  const autoMrrDisplay = hasAutoActivity ? autoMrr : null;
  const autoMrrDeltaPct = hasPrev && hasAutoActivity ? pctChange(autoMrr, prevAutoMrr) : null;
  const autoChurnDisplay = hasAutoActivity ? autoChurn : null;
  const autoChurnDeltaPp =
    hasPrev && hasAutoActivity && autoChurn != null && prevAutoChurn != null ? Number(autoChurn) - Number(prevAutoChurn) : null;

  const firstDataAt = metricsData ? isoDateFromTimestamp(metricsData?.meta?.firstDataAt || null) : "";
  const maxDate = defaultTo;

  const revenueLineSeries = hasPrev
    ? [
        { label: "Actual", values: revenueSeries },
        { label: "Periodo anterior", values: prevRevenueSeries, dashed: true }
      ]
    : [{ label: "Actual", values: revenueSeries }];
  const activeLineSeries = hasPrev
    ? [
        { label: "Actual", values: activeSubs },
        { label: "Periodo anterior", values: prevActiveSubs, dashed: true, color: "var(--chart-b)" }
      ]
    : [{ label: "Actual", values: activeSubs }];
  const mrrLineSeries =
    hasPrev && prevSeries.length
      ? [
          { label: "Actual", values: mrrSeries.map((v) => Number(v ?? 0)), color: "var(--chart-a)" },
          { label: "Periodo anterior", values: prevMrrSeries, color: "var(--chart-c)", dashed: true }
        ]
      : [{ label: "Actual", values: mrrSeries.map((v) => Number(v ?? 0)), color: "var(--chart-a)" }];
  const approvalRateLineSeries = hasPrev
    ? [
        { label: "Actual", values: approvalRateSeries, color: "var(--chart-a)" },
        { label: "Periodo anterior", values: prevApprovalRateSeries, dashed: true, color: "var(--chart-b)" }
      ]
    : [{ label: "Actual", values: approvalRateSeries, color: "var(--chart-a)" }];
  const linkConversionLineSeries = hasPrev
    ? [
        { label: "Actual", values: linkConversionSeries, color: "var(--chart-c)" },
        { label: "Periodo anterior", values: prevLinkConversionSeries, dashed: true, color: "var(--chart-b)" }
      ]
    : [{ label: "Actual", values: linkConversionSeries, color: "var(--chart-c)" }];

  const renderProductBreakdown = (
    items: any[],
    options?: { empty?: string; mode?: "revenue" | "payments" | "links" }
  ) => {
    if (!items.length) return <div className="muted">{options?.empty || "Sin datos por producto."}</div>;
    return (
      <div className="recent-payments">
        {items.slice(0, 5).map((item: any) => {
          const title = String(item?.productName || "Producto");
          const revenue = Number(item?.revenueInCents || 0);
          const paymentsSuccess = Number(item?.paymentsSuccess || 0);
          const paymentsFailed = Number(item?.paymentsFailed || 0);
          const linksSent = Number(item?.linksSent || 0);
          const linksPaid = Number(item?.linksPaid || 0);
          const subtitle =
            options?.mode === "links"
              ? `${linksSent} enviados · ${linksPaid} pagados`
              : options?.mode === "payments"
                ? `${paymentsSuccess} OK · ${paymentsFailed} fallidos`
                : `${paymentsSuccess} pagos OK`;
          return (
            <div className="recent-payment-row" key={String(item?.productId || title)}>
              <div className="recent-payment-main">
                <div className="recent-payment-title">{title}</div>
                <div className="recent-payment-sub">{subtitle}</div>
              </div>
              <div className="recent-payment-meta">
                <strong>${fmtMoneyCop(revenue)} COP</strong>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <main className="page pageWide metricsPage">
      <section className="settings-group">
        <div className="settings-group-header">
          <PageToolbar
            className="compact"
            search={(
              <MetricsFilters
                from={fromDate}
                to={toDate}
                g={g}
                tenantId={tenantId}
                tenants={tenants}
                minDate={firstDataAt || undefined}
                maxDate={maxDate}
              />
            )}
            summary={(
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="muted">{rangeLabel} · {periodLabel} · {tenantLabel}</span>
                <a className="ghost btn-compact btn-noicon btn-export" href={dailySummaryHref} data-loader="off">
                  Descargar resumen
                </a>
              </div>
            )}
          />
        </div>

        <div className="settings-group-body">
          {!metrics.ok ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error consultando métricas: {metrics.error || metrics.message || "No se pudo consultar métricas"}
            </div>
          ) : (
            <>
                  <div className="grid3">
                    <div className="card cardPad metric-card metric-card-lg tone-primary">
                      <span className="metric-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="5" width="20" height="14" rx="3" />
                          <circle cx="12" cy="12" r="3" />
                          <path d="M6 9h.01M18 15h.01" />
                        </svg>
                      </span>
                      <div className="metric-label">Ingresos totales</div>
                      <div className="metric-value">${fmtMoneyCop(totalRevenue)} COP</div>
                      <div className="metric-sub">
                        <span title="Promedio por pago aprobado (ingresos / pagos aprobados)">
                          Ticket promedio: ${fmtMoneyCop(avgTicket)} COP
                        </span>{" "}
                        ·{" "}
                        <span 
                          className={`delta ${revenueDeltaPct == null ? "flat" : revenueDeltaPct >= 0 ? "up" : "down"}`}
                          title="Δ compara el período actual vs el anterior (en %)"
                        >
                          {fmtDelta(revenueDeltaPct)}
                        </span>
                      </div>
                    </div>
                    <div className="card cardPad metric-card metric-card-lg metric-card-highlight tone-success">
                      <span className="metric-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M8 12l3 3 5-6" />
                        </svg>
                      </span>
                      <div className="metric-label">Tasa de aprobación</div>
                      <div className="metric-value">{fmtPct(approvalPct)}</div>
                      <div className="metric-sub">
                        <span title="Pagos aprobados y fallidos en el período">
                          {totalPaymentsOk} OK · {totalPaymentsFail} fallidos
                        </span>{" "}
                        ·{" "}
                        <span 
                          className={`delta ${approvalDeltaPp == null ? "flat" : approvalDeltaPp >= 0 ? "up" : "down"}`}
                          title="pp = puntos porcentuales de cambio vs el período anterior"
                        >
                          {fmtDeltaPp(approvalDeltaPp)}
                        </span>
                      </div>
                    </div>
                    <div className="card cardPad metric-card metric-card-lg metric-card-highlight tone-warning">
                      <span className="metric-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 13a5 5 0 0 0 7.1 0l2.1-2.1a5 5 0 0 0-7.1-7.1L10 5" />
                          <path d="M14 11a5 5 0 0 0-7.1 0L4.8 13.1a5 5 0 0 0 7.1 7.1L14 19" />
                        </svg>
                      </span>
                      <div className="metric-label">Conversión link → pago</div>
                      <div className="metric-value">{fmtPct(linkConversionPct)}</div>
                      <div className="metric-sub">
                        {hasLinkActivity ? (
                          <>
                            <span title="Links enviados y pagados en el período">
                              {linksSentTotal} enviados · {linksPaidTotal} pagados
                            </span>{" "}
                            ·{" "}
                            <span 
                              className={`delta ${linkConversionDeltaPp == null ? "flat" : linkConversionDeltaPp >= 0 ? "up" : "down"}`}
                              title="pp = puntos porcentuales de cambio vs el período anterior"
                            >
                              {fmtDeltaPp(linkConversionDeltaPp)}
                            </span>
                          </>
                        ) : (
                          <>Sin links enviados en el período.</>
                        )}
                      </div>
                    </div>
                    <div className="card cardPad metric-card metric-card-sm tone-info">
                      <span className="metric-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      </span>
                      <div className="metric-label">Suscripciones activas</div>
                      <div className="metric-value">{totalActiveSubscriptions}</div>
                      <div className="metric-sub">Δ {activeDelta >= 0 ? "+" : ""}{activeDelta} ({fmtPct(activeDeltaPct)})</div>
                    </div>
                    <div className="card cardPad metric-card metric-card-sm metric-card-highlight tone-primary">
                      <span className="metric-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                          <polyline points="21 3 21 9 15 9" />
                        </svg>
                      </span>
                      {/* El titular era el MRR de DÉBITO AUTOMÁTICO, y la mayoría de la
                          cartera cobra por link: el número mostraba una fracción del
                          negocio. Ahora es el recurrente de todas las suscripciones
                          activas, con el reparto por modo debajo. */}
                      <div className="metric-label">Ingreso recurrente</div>
                      <div className="metric-value">${fmtMoneyCop(subscriptionsBoard.totals.mrrInCents)} COP</div>
                      <div className="metric-sub">
                        {subscriptionsBoard.totals.subscriptions} suscripciones activas
                        {hasAutoActivity ? (
                          <> · de débito automático ${fmtMoneyCop(autoMrr)}</>
                        ) : null}
                      </div>
                    </div>
                    <div className="card cardPad metric-card metric-card-sm tone-warning">
                      <span className="metric-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                          <line x1="12" y1="22.08" x2="12" y2="12" />
                        </svg>
                      </span>
                      {/* "Planes vendidos" no dice si el mes va bien. Lo que lo dice es
                          cuánto del ciclo vigente se ha cobrado de lo que se esperaba
                          cobrar: es el número que la avería de agosto habría delatado
                          en cuanto pasó, y no había dónde verlo. */}
                      <div className="metric-label">Cobrado del ciclo</div>
                      <div className="metric-value">{fmtPct(tasaCobroPct)}</div>
                      <div className="metric-sub">
                        ${fmtMoneyCop(subscriptionsBoard.totals.collectedInCents)} de ${fmtMoneyCop(subscriptionsBoard.totals.expectedInCents)}
                        {subscriptionsBoard.totals.pendingInCents > 0 ? (
                          <> · faltan ${fmtMoneyCop(subscriptionsBoard.totals.pendingInCents)}</>
                        ) : null}
                      </div>
                    </div>
                  </div>



                  <CollectionSummary board={subscriptionsBoard} listHref="/billing" />

                  <details className="dashboard-advanced">
                    <summary>
                      <span>
                        <strong>Análisis avanzado</strong>
                        <small>Gráficos, pagos no asociados y automatizaciones</small>
                      </span>
                      <span className="dashboard-advanced-action">Mostrar</span>
                    </summary>
                    <div className="dashboard-advanced-body">
                  <div className="grid2">
                    <div className="card cardPad chart-card">
                      <div className="chart-header">
                        <div>
                          <div className="chart-title">Ingresos por período</div>
                          <div className="chart-sub">Suma de pagos aprobados por {periodLabel.toLowerCase()}.</div>
                        </div>
                        <div className="chart-range">{rangeLabel} · {periodLabel}</div>
                      </div>
                      <ChartLines
                        series={revenueLineSeries}
                        labels={bucketLabels}
                        tooltipLabel={(v, i, label) => `${bucketLabels[i] || ""} · ${label}: $${fmtMoneyCop(v)} COP`}
                      />
                      <div className="chart-kpis">
                        <span className="chart-kpi">Total <strong>${fmtMoneyCop(revenueTotalSeries)} COP</strong></span>
                        <span className="chart-kpi">Promedio <strong>${fmtMoneyCop(Math.round(revenueAvgSeries))} COP</strong></span>
                        <span className="chart-kpi">Último <strong>${fmtMoneyCop(revenueLast)} COP</strong></span>
                        <span className="chart-kpi">Máximo <strong>${fmtMoneyCop(revenueMax)} COP</strong></span>
                      </div>
                    </div>
                    <div className="card cardPad chart-card">
                      <div className="chart-header">
                        <div>
                          <div className="chart-title">MRR automático</div>
                          <div className="chart-sub">Evolución del ingreso recurrente mensual.</div>
                        </div>
                        <div className="chart-range">{rangeLabel}</div>
                      </div>
                      {hasAutoActivity ? (
                        mrrSeries.some((v) => Number(v || 0) > 0) ? (
                          <ChartLines
                            series={mrrLineSeries}
                            labels={bucketLabels}
                            tooltipLabel={(v, i, label) => `${bucketLabels[i] || ""} · ${label}: $${fmtMoneyCop(v)} COP`}
                          />
                        ) : (
                          <div className="muted">No hay datos de MRR en este período.</div>
                        )
                      ) : (
                        <div className="muted">Sin autosuscripciones activas en el período.</div>
                      )}
                      <div className="chart-kpis">
                        <span className="chart-kpi">MRR <strong>{autoMrrDisplay == null ? "—" : `$${fmtMoneyCop(autoMrr)} COP`}</strong></span>
                        <span className="chart-kpi">Δ <strong>{fmtDelta(autoMrrDeltaPct)}</strong></span>
                        <span className="chart-kpi">Churn <strong>{fmtPct(autoChurnDisplay)}</strong></span>
                      </div>
                    </div>
                  </div>

                  <div className="grid2">
                    <div className="card cardPad chart-card">
                      <div className="chart-header">
                        <div>
                          <div className="chart-title">Links de pago: enviados vs pagados</div>
                          <div className="chart-sub">Salud de los links manuales en el período.</div>
                        </div>
                        <div className="chart-range">{rangeLabel} · {periodLabel}</div>
                      </div>
                      {hasLinkActivity ? (
                        <ChartBars a={linksSent} b={linksPaid} aLabel="Enviados" bLabel="Pagados" labels={bucketLabels} />
                      ) : (
                        <div className="muted">Sin links enviados en el período.</div>
                      )}
                      <div className="chart-kpis">
                        <span className="chart-kpi">Conversión <strong>{fmtPct(linkConversionPct)}</strong></span>
                        <span className="chart-kpi">Ingresos <strong>${fmtMoneyCop(metricsData?.totals?.link?.revenueInCents || 0)} COP</strong></span>
                        <span className="chart-kpi">
                          Tiempo prom. <strong>{metricsData?.totals?.link?.avgTimeToPaySec == null ? "—" : `${Math.round(Number(metricsData.totals.link.avgTimeToPaySec) / 60)} min`}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="card cardPad chart-card">
                      <div className="chart-header">
                        <div>
                          <div className="chart-title">Tasa de aprobación por período</div>
                          <div className="chart-sub">Calidad de cobros por {periodLabel.toLowerCase()}.</div>
                        </div>
                        <div className="chart-range">{rangeLabel} · {periodLabel}</div>
                      </div>
                      <ChartLines
                        series={approvalRateLineSeries}
                        labels={bucketLabels}
                        tooltipLabel={(v, i, label) => `${bucketLabels[i] || ""} · ${label}: ${fmtPct(v)}`}
                      />
                      <div className="chart-kpis">
                        <span className="chart-kpi">Promedio <strong>{fmtPct(approvalRateAvg)}</strong></span>
                        <span className="chart-kpi">Último <strong>{fmtPct(approvalRateLast)}</strong></span>
                        <span className="chart-kpi">Máximo <strong>{fmtPct(approvalRateMax)}</strong></span>
                      </div>
                    </div>
                  </div>

                  <div className="grid2">
                    <div className="card cardPad chart-card">
                      <div className="chart-header">
                        <div>
                          <div className="chart-title">Pagos sin suscripción</div>
                          <div className="chart-sub">One-time, huérfanos y links manuales sin suscripción asociada.</div>
                        </div>
                        <div className="chart-range">{rangeLabel}</div>
                      </div>
                      <div className="grid2" style={{ gap: 10 }}>
                        <div className="card cardPad" style={{ padding: 10 }}>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>Aprobados</div>
                          <div style={{ fontSize: 18, fontWeight: 900 }}>{unlinkedPaymentsApproved}</div>
                          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                            Total {unlinkedPaymentsTotal} · Otros {unlinkedPaymentsOther}
                          </div>
                        </div>
                        <div className="card cardPad" style={{ padding: 10 }}>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>Ingresos</div>
                          <div style={{ fontSize: 18, fontWeight: 900 }}>${fmtMoneyCop(unlinkedRevenue)} COP</div>
                          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                            Prom. ${unlinkedPaymentsApproved > 0 ? fmtMoneyCop(Math.round(unlinkedRevenue / unlinkedPaymentsApproved)) : "—"}
                          </div>
                        </div>
                      </div>
                      <div className="field-hint" style={{ marginTop: 10, fontStyle: "italic" }}>
                        💡 Estos pagos no están asociados a suscripciones. Pueden ser pagos únicos, links manuales o pagos huérfanos que requieren revisión.
                      </div>
                    </div>
                  </div>

                  <ScheduledJobsPanel report={jobsReport} />

                    </div>
                  </details>

            </>
          )}
          {aiEnabled ? (
            <div className="logs-ai-wrapper" style={{ marginTop: 18 }}>
              <AiAssistant
                from={fromDate}
                to={toDate}
                tenantId={tenantId || undefined}
                scope="metrics"
                title="Asistente de Métricas"
                emptyText="Pregunta por ingresos, pagos, suscripciones o conversión. Ej: “¿Cómo cambió la aprobación esta semana?”."
                placeholder="Pregunta sobre métricas y tendencias..."
              />
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
