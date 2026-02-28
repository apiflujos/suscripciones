import Link from "next/link";
import { fetchAdminCached, fetchPublicCached, getAdminApiConfig } from "./lib/adminApi";
import { HelpTip } from "./ui/HelpTip";

function fmtMoneyCop(cents: number) {
  const v = (Number(cents || 0) / 100).toFixed(0);
  return new Intl.NumberFormat("es-CO").format(Number(v));
}

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(1)}%`;
}

function fmtDelta(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

function fmtDeltaPp(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(1)} pp`;
}

function fmtShortDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtBucketLabel(isoStr: string, g: "day" | "week" | "month") {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  if (g === "month") return d.toLocaleDateString("es-CO", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

function sum(values: number[]) {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

function pctChange(current: number, prev: number) {
  if (!Number.isFinite(current) || !Number.isFinite(prev) || prev === 0) return null;
  return ((current - prev) / Math.abs(prev)) * 100;
}

function toUtcIsoStart(dateStr: string) {
  const [y, m, d] = String(dateStr || "").split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)).toISOString();
}

function toUtcIsoEndExclusive(dateStr: string) {
  const [y, m, d] = String(dateStr || "").split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0)).toISOString();
}

function isoDateUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)).toISOString().slice(0, 10);
}

function ChartLine({
  values,
  labels,
  tooltipLabel,
  height = 120
}: {
  values: number[];
  labels?: string[];
  tooltipLabel?: (value: number, index: number) => string;
  height?: number;
}) {
  const w = 520;
  const h = height;
  const pad = 10;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
    const y = h - pad - (Math.max(0, v) * (h - pad * 2)) / max;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const labelIdxs = values.length > 1 ? Array.from(new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])) : [0];
  const step = Math.max(1, Math.ceil(values.length / 12));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="var(--chart-axis)" />
      {values.map((v, i) => {
        if (i % step !== 0 && i !== values.length - 1) return null;
        const x = pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
        const y = h - pad - (Math.max(0, v) * (h - pad * 2)) / max;
        const tip = tooltipLabel ? tooltipLabel(v, i) : `${labels?.[i] || ""} · ${v}`;
        return (
          <g key={`pt-${i}`}>
            <circle cx={x} cy={y} r="3" fill="var(--primary)" />
            <title>{tip}</title>
          </g>
        );
      })}
      {labels
        ? labelIdxs.map((i) => {
            const x = pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
            const textAnchor = i === 0 ? "start" : i === values.length - 1 ? "end" : "middle";
            return (
              <text
                key={`label-${i}`}
                x={x}
                y={h - 2}
                textAnchor={textAnchor}
                fontSize="10"
                fill="var(--text-faint)"
              >
                {labels[i] || ""}
              </text>
            );
          })
        : null}
    </svg>
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
  const max = Math.max(1, ...a, ...b);
  const n = Math.max(a.length, b.length);
  const gap = 6;
  const groupW = (w - pad * 2) / Math.max(1, n);
  const barW = Math.max(2, (groupW - gap) / 2);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden="true">
        {Array.from({ length: n }).map((_, i) => {
          const x0 = pad + i * groupW;
          const va = a[i] ?? 0;
          const vb = b[i] ?? 0;
          const ha = (Math.max(0, va) * (h - pad * 2)) / max;
          const hb = (Math.max(0, vb) * (h - pad * 2)) / max;
          return (
            <g key={i}>
              <rect x={x0} y={h - pad - ha} width={barW} height={ha} fill="var(--chart-a)" rx="3">
                <title>{`${labels?.[i] || ""} · ${aLabel}: ${va}`}</title>
              </rect>
              <rect x={x0 + barW + gap} y={h - pad - hb} width={barW} height={hb} fill="var(--chart-b)" rx="3">
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

function Pie({ a, b, aLabel, bLabel }: { a: number; b: number; aLabel: string; bLabel: string }) {
  const total = Math.max(0, a) + Math.max(0, b);
  const aFrac = total > 0 ? Math.max(0, a) / total : 0;
  const r = 36;
  const c = 2 * Math.PI * r;
  const aLen = aFrac * c;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 12, alignItems: "center" }}>
      <svg viewBox="0 0 100 100" width="96" height="96" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--chart-track)" strokeWidth="18" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--chart-a)"
          strokeWidth="18"
          strokeDasharray={`${aLen} ${c - aLen}`}
          transform="rotate(-90 50 50)"
          strokeLinecap="round"
        />
      </svg>
      <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span style={{ color: "var(--muted)" }}>{aLabel}</span>
          <strong>{fmtMoneyCop(a)}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span style={{ color: "var(--muted)" }}>{bLabel}</span>
          <strong>{fmtMoneyCop(b)}</strong>
        </div>
      </div>
    </div>
  );
}

export default async function Home({
  searchParams
}: {
  searchParams?: Promise<{ from?: string; to?: string; g?: string; tenantId?: string }>;
}) {
  const health = await fetchPublicCached("/health", { ttlMs: 3000 });

  const { token } = getAdminApiConfig();
  const hasToken = !!token;

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

  const tenantsRes = hasToken ? await fetchAdminCached("/admin/tenants", { ttlMs: 1500 }) : { ok: false, json: { items: [] } };
  const tenants = Array.isArray(tenantsRes?.json?.items) ? tenantsRes.json.items : [];
  const tenantLabel = tenantId ? (tenants.find((t: any) => String(t.id) === String(tenantId))?.name || "Canal") : "Todos";

  const metricsQuery = new URLSearchParams({
    from: fromIso,
    to: toIso,
    granularity: g,
    ...(tenantId ? { tenantId } : {})
  });

  const metrics = hasToken
    ? await fetchAdminCached(`/admin/metrics/overview?${metricsQuery.toString()}`, { ttlMs: 1500 })
    : { ok: false, status: 401, json: { error: "missing_admin_token" } };

  const periodMs = Math.max(24 * 60 * 60 * 1000, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const prevFromIso = new Date(new Date(fromIso).getTime() - periodMs).toISOString();
  const prevToIso = new Date(fromIso).toISOString();
  const prevMetricsQuery = new URLSearchParams({
    from: prevFromIso,
    to: prevToIso,
    granularity: g,
    ...(tenantId ? { tenantId } : {})
  });
  const prevMetrics = hasToken
    ? await fetchAdminCached(`/admin/metrics/overview?${prevMetricsQuery.toString()}`, { ttlMs: 1500 })
    : { ok: false, status: 401, json: { error: "missing_admin_token" } };

  const series: any[] = metrics.ok ? metrics.json?.series || [] : [];
  const revenueSeries = series.map((p) => Number(p?.revenueInCents ?? 0));
  const okSeries = series.map((p) => Number(p?.paymentsSuccess ?? 0));
  const failSeries = series.map((p) => Number(p?.paymentsFailed ?? 0));
  const linksSent = series.map((p) => Number(p?.linksSent ?? 0));
  const linksPaid = series.map((p) => Number(p?.linksPaid ?? 0));
  const activeSubs = series.map((p) => Number(p?.activeSubscriptions ?? 0));
  const mrrSeries = series.map((p) => (p?.mrrInCents == null ? null : Number(p.mrrInCents)));
  const bucketLabels = series.map((p) => fmtBucketLabel(String(p?.at || ""), g));

  const totalRevenue = Number(metrics.json?.totals?.totalRevenueInCents || 0);
  const totalPaymentsOk = Number(metrics.json?.totals?.totalPaymentsSuccessful || 0);
  const totalPaymentsFail = Number(metrics.json?.totals?.totalPaymentsFailed || 0);
  const totalPayments = totalPaymentsOk + totalPaymentsFail;
  const approvalPct = totalPayments > 0 ? (totalPaymentsOk / totalPayments) * 100 : 0;
  const avgTicket = totalPaymentsOk > 0 ? Math.round(totalRevenue / totalPaymentsOk) : 0;
  const totalActiveSubscriptions = Number(metrics.json?.totals?.totalActiveSubscriptions || 0);
  const linkConversionPct = Number(metrics.json?.totals?.link?.conversionLinkToPayPct || 0);
  const autoMrr = Number(metrics.json?.totals?.auto?.mrrInCents || 0);

  const revenueTotalSeries = sum(revenueSeries);
  const revenueAvgSeries = avg(revenueSeries);
  const revenueLast = revenueSeries[revenueSeries.length - 1] ?? 0;
  const revenueMax = Math.max(0, ...revenueSeries);

  const okTotalSeries = sum(okSeries);
  const failTotalSeries = sum(failSeries);
  const successRateSeries = okTotalSeries + failTotalSeries > 0 ? (okTotalSeries / (okTotalSeries + failTotalSeries)) * 100 : 0;
  const linksSentTotal = sum(linksSent);
  const linksPaidTotal = sum(linksPaid);
  const activeStart = activeSubs[0] ?? 0;
  const activeEnd = activeSubs[activeSubs.length - 1] ?? 0;
  const activeDelta = activeEnd - activeStart;
  const activeDeltaPct = activeStart > 0 ? (activeDelta / activeStart) * 100 : null;

  const revenueLink = Number(metrics.json?.breakdown?.revenueByPlanTypeInCents?.manual_link || 0);
  const revenueAuto = Number(metrics.json?.breakdown?.revenueByPlanTypeInCents?.auto_subscription || 0);
  const revenueByTypeTotal = revenueLink + revenueAuto;
  const revenueLinkPct = revenueByTypeTotal > 0 ? (revenueLink / revenueByTypeTotal) * 100 : 0;
  const revenueAutoPct = revenueByTypeTotal > 0 ? (revenueAuto / revenueByTypeTotal) * 100 : 0;

  const prevTotals = prevMetrics.ok ? prevMetrics.json?.totals || {} : {};
  const hasPrev = prevMetrics.ok;
  const prevRevenue = Number(prevTotals?.totalRevenueInCents || 0);
  const prevPaymentsOk = Number(prevTotals?.totalPaymentsSuccessful || 0);
  const prevPaymentsFail = Number(prevTotals?.totalPaymentsFailed || 0);
  const prevPaymentsTotal = prevPaymentsOk + prevPaymentsFail;
  const prevApprovalPct = prevPaymentsTotal > 0 ? (prevPaymentsOk / prevPaymentsTotal) * 100 : 0;
  const prevLinkConversion = Number(prevTotals?.link?.conversionLinkToPayPct || 0);
  const prevPlansSold = Number(prevTotals?.totalPlansSold || 0);

  const revenueDeltaPct = hasPrev ? pctChange(totalRevenue, prevRevenue) : null;
  const approvalDeltaPp = hasPrev ? approvalPct - prevApprovalPct : null;
  const linkConversionDeltaPp = hasPrev ? linkConversionPct - prevLinkConversion : null;
  const plansDeltaPct = hasPrev ? pctChange(metrics.json?.totals?.totalPlansSold || 0, prevPlansSold) : null;

  const alerts: Array<{ title: string; detail: string; level: "warning" | "danger" }> = [];
  if (totalPayments >= 10 && approvalPct < 80) {
    alerts.push({ title: "Baja tasa de aprobación", detail: `Solo ${fmtPct(approvalPct)} de pagos aprobados.`, level: "danger" });
  }
  if (linksSentTotal >= 10 && linkConversionPct < 10) {
    alerts.push({ title: "Conversión de links baja", detail: `Conversión actual: ${fmtPct(linkConversionPct)}.`, level: "warning" });
  }
  if (revenueDeltaPct != null && revenueDeltaPct <= -10) {
    alerts.push({ title: "Ingresos en descenso", detail: `Variación: ${fmtDelta(revenueDeltaPct)} vs periodo anterior.`, level: "warning" });
  }
  if (activeDelta < 0) {
    alerts.push({ title: "Menos suscripciones activas", detail: `Se perdieron ${Math.abs(activeDelta)} suscriptores en el periodo.`, level: "warning" });
  }
  if (metrics.json?.totals?.auto?.churnMonthlyPct != null && Number(metrics.json.totals.auto.churnMonthlyPct) > 5) {
    alerts.push({ title: "Churn mensual alto", detail: `Churn: ${fmtPct(metrics.json.totals.auto.churnMonthlyPct)}.`, level: "danger" });
  }

  return (
    <main className="page pageWide">
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="filtersRow">
            <div className="filtersLeft">
              <div className="filtersNote">Filtros de análisis</div>
              <div className="filtersPanel">
                <form method="get" className="filtersForm">
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Desde (UTC)</span>
                      <HelpTip text="Fecha de inicio del rango en UTC." />
                    </label>
                    <input className="input" type="date" name="from" defaultValue={fromDate} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Hasta (UTC)</span>
                      <HelpTip text="Fecha de cierre del rango en UTC (incluye todo el día)." />
                    </label>
                    <input className="input" type="date" name="to" defaultValue={toDate} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Periodo</span>
                      <HelpTip text="Agrupación de datos: día, semana o mes." />
                    </label>
                    <select className="select" name="g" defaultValue={g}>
                      <option value="day">Día</option>
                      <option value="week">Semana</option>
                      <option value="month">Mes</option>
                    </select>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Canal</span>
                      <HelpTip text="Segmenta métricas por canal específico." />
                    </label>
                    <select className="select" name="tenantId" defaultValue={tenantId}>
                      <option value="">Todos</option>
                      {tenants.map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="primary" type="submit" style={{ height: 38 }}>
                    Ver
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          {!hasToken ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Falta <code>ADMIN_API_TOKEN</code> en el Admin para consultar el API de métricas.
            </div>
          ) : !metrics.ok ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error consultando métricas: {metrics.json?.error || `HTTP ${metrics.status}`}
            </div>
          ) : (
            <>
              <div className="insights-card">
                <div className="insights-title">Insights clave</div>
                <div className="insights-grid">
                  <div className="insight-item">
                    Ingresos vs periodo anterior:
                    <span className={`delta ${revenueDeltaPct == null ? "flat" : revenueDeltaPct >= 0 ? "up" : "down"}`}>
                      {fmtDelta(revenueDeltaPct)}
                    </span>
                  </div>
                  <div className="insight-item">
                    Aprobación de pagos:
                    <span className={`delta ${approvalDeltaPp == null ? "flat" : approvalDeltaPp >= 0 ? "up" : "down"}`}>{fmtDeltaPp(approvalDeltaPp)}</span>
                  </div>
                  <div className="insight-item">
                    Conversión de links:
                    <span className={`delta ${linkConversionDeltaPp == null ? "flat" : linkConversionDeltaPp >= 0 ? "up" : "down"}`}>{fmtDeltaPp(linkConversionDeltaPp)}</span>
                  </div>
                  <div className="insight-item">
                    Planes vendidos:
                    <span className={`delta ${plansDeltaPct == null ? "flat" : plansDeltaPct >= 0 ? "up" : "down"}`}>
                      {fmtDelta(plansDeltaPct)}
                    </span>
                  </div>
                </div>
                <div className="insights-foot">
                  Comparativo: {fmtShortDate(prevFromIso.slice(0, 10))} → {fmtShortDate(prevToIso.slice(0, 10))} · Canal: {tenantLabel}
                </div>
              </div>

              <div className="alerts-card">
                <div className="alerts-title">Alertas operativas</div>
                {alerts.length ? (
                  <div className="alerts-grid">
                    {alerts.map((a, idx) => (
                      <div key={`alert-${idx}`} className={`alert-item ${a.level === "danger" ? "is-danger" : "is-warning"}`}>
                        <div className="alert-title">{a.title}</div>
                        <div className="alert-detail">{a.detail}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="alert-empty">Sin alertas críticas en este rango.</div>
                )}
              </div>

              <div className="grid3">
                <div className="card cardPad metric-card tone-primary">
                  <div className="metric-label">Ingresos totales</div>
                  <div className="metric-value">${fmtMoneyCop(totalRevenue)} COP</div>
                  <div className="metric-sub">
                    Ticket promedio: ${fmtMoneyCop(avgTicket)} COP ·
                    <span className={`delta ${revenueDeltaPct == null ? "flat" : revenueDeltaPct >= 0 ? "up" : "down"}`}>
                      {fmtDelta(revenueDeltaPct)}
                    </span>
                  </div>
                </div>
                <div className="card cardPad metric-card tone-success">
                  <div className="metric-label">Tasa de aprobación</div>
                  <div className="metric-value">{fmtPct(approvalPct)}</div>
                  <div className="metric-sub">
                    {totalPaymentsOk} OK · {totalPaymentsFail} fallidos ·
                    <span className={`delta ${approvalDeltaPp == null ? "flat" : approvalDeltaPp >= 0 ? "up" : "down"}`}>{fmtDeltaPp(approvalDeltaPp)}</span>
                  </div>
                </div>
                <div className="card cardPad metric-card tone-warning">
                  <div className="metric-label">Conversión link → pago</div>
                  <div className="metric-value">{fmtPct(linkConversionPct)}</div>
                  <div className="metric-sub">
                    {linksSentTotal} enviados · {linksPaidTotal} pagados ·
                    <span className={`delta ${linkConversionDeltaPp == null ? "flat" : linkConversionDeltaPp >= 0 ? "up" : "down"}`}>{fmtDeltaPp(linkConversionDeltaPp)}</span>
                  </div>
                </div>
                <div className="card cardPad metric-card tone-info">
                  <div className="metric-label">Suscripciones activas</div>
                  <div className="metric-value">{totalActiveSubscriptions}</div>
                  <div className="metric-sub">Δ {activeDelta >= 0 ? "+" : ""}{activeDelta} ({fmtPct(activeDeltaPct)})</div>
                </div>
                <div className="card cardPad metric-card tone-primary">
                  <div className="metric-label">MRR automático</div>
                  <div className="metric-value">${fmtMoneyCop(autoMrr)} COP</div>
                  <div className="metric-sub">Churn mensual: {fmtPct(metrics.json?.totals?.auto?.churnMonthlyPct)}</div>
                </div>
                <div className="card cardPad metric-card tone-warning">
                  <div className="metric-label">Planes vendidos</div>
                  <div className="metric-value">{metrics.json?.totals?.totalPlansSold || 0}</div>
                  <div className="metric-sub">
                    Rango: {rangeLabel} ·
                    <span className={`delta ${plansDeltaPct == null ? "flat" : plansDeltaPct >= 0 ? "up" : "down"}`}>
                      {fmtDelta(plansDeltaPct)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid2">
                <div className="card cardPad chart-card">
                  <div className="chart-header">
                    <div>
                      <div className="chart-title">Ingresos por período</div>
                      <div className="chart-sub">Suma de pagos aprobados por {periodLabel.toLowerCase()}.</div>
                    </div>
                    <div className="chart-range">{rangeLabel} · {periodLabel}</div>
                  </div>
                  <ChartLine
                    values={revenueSeries}
                    labels={bucketLabels}
                    tooltipLabel={(v, i) => `${bucketLabels[i] || ""} · $${fmtMoneyCop(v)} COP`}
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
                      <div className="chart-title">Pagos aprobados vs fallidos</div>
                      <div className="chart-sub">Comparación de intentos por {periodLabel.toLowerCase()}.</div>
                    </div>
                    <div className="chart-range">{rangeLabel} · {periodLabel}</div>
                  </div>
                  <ChartBars a={okSeries} b={failSeries} aLabel="Aprobados" bLabel="Fallidos" labels={bucketLabels} />
                  <div className="chart-kpis">
                    <span className="chart-kpi">Aprobados <strong>{okTotalSeries}</strong></span>
                    <span className="chart-kpi">Fallidos <strong>{failTotalSeries}</strong></span>
                    <span className="chart-kpi">Tasa OK <strong>{fmtPct(successRateSeries)}</strong></span>
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
                  <ChartBars a={linksSent} b={linksPaid} aLabel="Enviados" bLabel="Pagados" labels={bucketLabels} />
                  <div className="chart-kpis">
                    <span className="chart-kpi">Conversión <strong>{fmtPct(metrics.json?.totals?.link?.conversionLinkToPayPct)}</strong></span>
                    <span className="chart-kpi">Ingresos <strong>${fmtMoneyCop(metrics.json?.totals?.link?.revenueInCents || 0)} COP</strong></span>
                    <span className="chart-kpi">
                      Tiempo prom. <strong>{metrics.json?.totals?.link?.avgTimeToPaySec == null ? "—" : `${Math.round(Number(metrics.json.totals.link.avgTimeToPaySec) / 60)} min`}</strong>
                    </span>
                  </div>
                </div>

                <div className="card cardPad chart-card">
                  <div className="chart-header">
                    <div>
                      <div className="chart-title">Ingresos por tipo de plan</div>
                      <div className="chart-sub">Distribución entre manuales y automáticos.</div>
                    </div>
                    <div className="chart-range">{rangeLabel}</div>
                  </div>
                  <Pie
                    a={revenueLink}
                    b={revenueAuto}
                    aLabel="Link"
                    bLabel="Auto"
                  />
                  <div className="chart-kpis">
                    <span className="chart-kpi">Manual <strong>{fmtPct(revenueLinkPct)}</strong></span>
                    <span className="chart-kpi">Auto <strong>{fmtPct(revenueAutoPct)}</strong></span>
                    <span className="chart-kpi">Total <strong>${fmtMoneyCop(revenueByTypeTotal)} COP</strong></span>
                  </div>
                </div>
              </div>

              <div className="grid2">
                <div className="card cardPad chart-card">
                  <div className="chart-header">
                    <div>
                      <div className="chart-title">Suscripciones activas</div>
                      <div className="chart-sub">Evolución del total de suscriptores activos.</div>
                    </div>
                    <div className="chart-range">{rangeLabel} · {periodLabel}</div>
                  </div>
                  <ChartLine
                    values={activeSubs}
                    labels={bucketLabels}
                    tooltipLabel={(v, i) => `${bucketLabels[i] || ""} · ${v} activas`}
                  />
                  <div className="chart-kpis">
                    <span className="chart-kpi">Inicio <strong>{activeStart}</strong></span>
                    <span className="chart-kpi">Fin <strong>{activeEnd}</strong></span>
                    <span className="chart-kpi">Δ <strong>{activeDelta >= 0 ? "+" : ""}{activeDelta}</strong></span>
                    <span className="chart-kpi">Δ% <strong>{fmtPct(activeDeltaPct)}</strong></span>
                  </div>
                </div>

                <div className="card cardPad chart-card">
                  <div className="chart-header">
                    <div>
                      <div className="chart-title">Suscripción automática</div>
                      <div className="chart-sub">Estado y desempeño de cobros recurrentes.</div>
                    </div>
                    <div className="chart-range">{rangeLabel}</div>
                  </div>
                  <div className="grid2" style={{ gap: 10 }}>
                    <div className="card cardPad" style={{ padding: 10 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Activas</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>{metrics.json?.totals?.auto?.activeSubscriptions || 0}</div>
                    </div>
                    <div className="card cardPad" style={{ padding: 10 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Nuevas / Cancelaciones</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>
                        {metrics.json?.totals?.auto?.newSubscriptions || 0} / {metrics.json?.totals?.auto?.cancellations || 0}
                      </div>
                    </div>
                    <div className="card cardPad" style={{ padding: 10 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Cobros OK / Fallidos</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>
                        {metrics.json?.totals?.auto?.autoChargesSuccessful || 0} / {metrics.json?.totals?.auto?.autoChargesFailed || 0}
                      </div>
                    </div>
                    <div className="card cardPad" style={{ padding: 10 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>MRR (auto)</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>${fmtMoneyCop(metrics.json?.totals?.auto?.mrrInCents || 0)} COP</div>
                    </div>
                  </div>
                  {mrrSeries.some((v) => v != null) ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Evolución MRR (mes)</div>
                      <ChartLine
                        values={mrrSeries.map((v) => Number(v ?? 0))}
                        labels={bucketLabels}
                        tooltipLabel={(v, i) => `${bucketLabels[i] || ""} · $${fmtMoneyCop(v)} COP`}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
