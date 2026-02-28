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
  height = 120
}: {
  values: number[];
  labels?: string[];
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
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="var(--chart-axis)" />
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
  height = 120
}: {
  a: number[];
  b: number[];
  aLabel: string;
  bLabel: string;
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
              <rect x={x0} y={h - pad - ha} width={barW} height={ha} fill="var(--chart-a)" rx="3" />
              <rect x={x0 + barW + gap} y={h - pad - hb} width={barW} height={hb} fill="var(--chart-b)" rx="3" />
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
  searchParams?: Promise<{ from?: string; to?: string; g?: string }>;
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
  const fromIso = toUtcIsoStart(fromDate) || toUtcIsoStart(defaultFrom)!;
  const toIso = toUtcIsoEndExclusive(toDate) || toUtcIsoEndExclusive(defaultTo)!;
  const periodLabel = g === "day" ? "Diario" : g === "week" ? "Semanal" : "Mensual";
  const rangeLabel = `${fmtShortDate(fromDate)} → ${fmtShortDate(toDate)}`;

  const metrics = hasToken
    ? await fetchAdminCached(
        `/admin/metrics/overview?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&granularity=${encodeURIComponent(g)}`,
        { ttlMs: 1500 }
      )
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

  return (
    <main className="page pageWide">
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="filtersRow">
            <div className="filtersLeft">
              <div className="filtersNote">Ajusta rango y granularidad para leer la evolución de las métricas.</div>
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
              <div className="grid3">
                <div className="card cardPad metric-card">
                  <div className="metric-label">Ingresos totales</div>
                  <div className="metric-value">${fmtMoneyCop(totalRevenue)} COP</div>
                  <div className="metric-sub">Ticket promedio: ${fmtMoneyCop(avgTicket)} COP</div>
                </div>
                <div className="card cardPad metric-card">
                  <div className="metric-label">Tasa de aprobación</div>
                  <div className="metric-value">{fmtPct(approvalPct)}</div>
                  <div className="metric-sub">{totalPaymentsOk} OK · {totalPaymentsFail} fallidos</div>
                </div>
                <div className="card cardPad metric-card">
                  <div className="metric-label">Conversión link → pago</div>
                  <div className="metric-value">{fmtPct(linkConversionPct)}</div>
                  <div className="metric-sub">{linksSentTotal} enviados · {linksPaidTotal} pagados</div>
                </div>
                <div className="card cardPad metric-card">
                  <div className="metric-label">Suscripciones activas</div>
                  <div className="metric-value">{totalActiveSubscriptions}</div>
                  <div className="metric-sub">Δ {activeDelta >= 0 ? "+" : ""}{activeDelta} ({fmtPct(activeDeltaPct)})</div>
                </div>
                <div className="card cardPad metric-card">
                  <div className="metric-label">MRR automático</div>
                  <div className="metric-value">${fmtMoneyCop(autoMrr)} COP</div>
                  <div className="metric-sub">Churn mensual: {fmtPct(metrics.json?.totals?.auto?.churnMonthlyPct)}</div>
                </div>
                <div className="card cardPad metric-card">
                  <div className="metric-label">Planes vendidos</div>
                  <div className="metric-value">{metrics.json?.totals?.totalPlansSold || 0}</div>
                  <div className="metric-sub">Rango: {rangeLabel}</div>
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
                  <ChartLine values={revenueSeries} labels={bucketLabels} />
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
                  <ChartBars a={okSeries} b={failSeries} aLabel="Aprobados" bLabel="Fallidos" />
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
                  <ChartBars a={linksSent} b={linksPaid} aLabel="Enviados" bLabel="Pagados" />
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
                  <ChartLine values={activeSubs} labels={bucketLabels} />
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
                      <ChartLine values={mrrSeries.map((v) => Number(v ?? 0))} labels={bucketLabels} />
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
