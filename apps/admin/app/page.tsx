import Link from "next/link";
import { fetchAdminCached, fetchPublicCached, getAdminApiConfig } from "./lib/adminApi";

function fmtMoneyCop(cents: number) {
  const v = (Number(cents || 0) / 100).toFixed(0);
  return new Intl.NumberFormat("es-CO").format(Number(v));
}

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(1)}%`;
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

function ChartLine({ values, height = 120 }: { values: number[]; height?: number }) {
  const w = 520;
  const h = height;
  const pad = 10;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
    const y = h - pad - (Math.max(0, v) * (h - pad * 2)) / max;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="rgba(15, 23, 42, 0.12)" />
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
              <rect x={x0} y={h - pad - ha} width={barW} height={ha} fill="rgba(14, 116, 144, 0.9)" rx="3" />
              <rect x={x0 + barW + gap} y={h - pad - hb} width={barW} height={hb} fill="rgba(239, 68, 68, 0.85)" rx="3" />
            </g>
          );
        })}
        <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="rgba(15, 23, 42, 0.12)" />
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--muted)", fontSize: 12 }}>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(14, 116, 144, 0.9)", borderRadius: 2, marginRight: 6 }} />{" "}
          {aLabel}
        </span>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(239, 68, 68, 0.85)", borderRadius: 2, marginRight: 6 }} />{" "}
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
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(15, 23, 42, 0.10)" strokeWidth="18" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="rgba(14, 116, 144, 0.95)"
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

export default async function Home({ searchParams }: { searchParams?: { from?: string; to?: string; g?: string } }) {
  const health = await fetchPublicCached("/health", { ttlMs: 3000 });

  const { token } = getAdminApiConfig();
  const hasToken = !!token;

  const now = new Date();
  const defaultTo = isoDateUtc(now);
  const defaultFrom = isoDateUtc(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));

  const g = (searchParams?.g === "week" || searchParams?.g === "month" ? searchParams?.g : "day") as "day" | "week" | "month";
  const fromDate = searchParams?.from || defaultFrom;
  const toDate = searchParams?.to || defaultTo;
  const fromIso = toUtcIsoStart(fromDate) || toUtcIsoStart(defaultFrom)!;
  const toIso = toUtcIsoEndExclusive(toDate) || toUtcIsoEndExclusive(defaultTo)!;

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

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h1 className="pageTitle">Métricas</h1>
        <p className="pageSub">Link de pago vs suscripción automática.</p>
      </div>

      <div className="card cardPad" style={{ display: "grid", gap: 10 }}>
        <strong>Estado API</strong>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className={`pill ${health.ok ? "" : "pillDanger"}`}>{health.ok ? "OK" : `ERROR (${health.status})`}</span>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            Salud:{" "}
            <Link href="/logs" prefetch={false} style={{ textDecoration: "underline" }}>
              ver logs
            </Link>
          </span>
        </div>
        {!hasToken ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Para ver métricas completas, configura <code>API_ADMIN_TOKEN</code> en el Admin.
          </div>
        ) : null}
      </div>

      <section className="settings-group">
        <div className="settings-group-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <div className="settings-group-title">Dashboard</div>
            <h3 style={{ margin: 0 }}>Métricas por periodo</h3>
          </div>

          <form method="get" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Desde (UTC)</label>
              <input className="input" type="date" name="from" defaultValue={fromDate} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Hasta (UTC)</label>
              <input className="input" type="date" name="to" defaultValue={toDate} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Periodo</label>
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

        <div className="settings-group-body">
          {!hasToken ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Falta <code>API_ADMIN_TOKEN</code> en el Admin para consultar el API de métricas.
            </div>
          ) : !metrics.ok ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error consultando métricas: {metrics.json?.error || `HTTP ${metrics.status}`}
            </div>
          ) : (
            <>
              <div className="grid4">
                <div className="card cardPad">
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Ingresos</div>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>${fmtMoneyCop(metrics.json?.totals?.totalRevenueInCents || 0)} COP</div>
                </div>
                <div className="card cardPad">
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Pagos OK / Fallidos</div>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>
                    {metrics.json?.totals?.totalPaymentsSuccessful || 0} / {metrics.json?.totals?.totalPaymentsFailed || 0}
                  </div>
                </div>
                <div className="card cardPad">
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Planes vendidos</div>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>{metrics.json?.totals?.totalPlansSold || 0}</div>
                </div>
                <div className="card cardPad">
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Suscripciones activas</div>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>{metrics.json?.totals?.totalActiveSubscriptions || 0}</div>
                </div>
              </div>

              <div className="grid2">
                <div className="card cardPad" style={{ display: "grid", gap: 8 }}>
                  <strong>Ingresos totales (línea)</strong>
                  <ChartLine values={revenueSeries} />
                </div>

                <div className="card cardPad" style={{ display: "grid", gap: 8 }}>
                  <strong>Pagos OK vs Fallidos (barras)</strong>
                  <ChartBars a={okSeries} b={failSeries} aLabel="OK" bLabel="Fallidos" />
                </div>
              </div>

              <div className="grid2">
                <div className="card cardPad" style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <strong>Links enviados vs pagados</strong>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>Conversión: {fmtPct(metrics.json?.totals?.link?.conversionLinkToPayPct)}</span>
                  </div>
                  <ChartBars a={linksSent} b={linksPaid} aLabel="Enviados" bLabel="Pagados" />
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: "var(--muted)", fontSize: 12 }}>
                    <span>Ingresos por link: ${fmtMoneyCop(metrics.json?.totals?.link?.revenueInCents || 0)} COP</span>
                    <span>
                      Tiempo prom.:{" "}
                      {metrics.json?.totals?.link?.avgTimeToPaySec == null ? "—" : `${Math.round(Number(metrics.json.totals.link.avgTimeToPaySec) / 60)} min`}
                    </span>
                  </div>
                </div>

                <div className="card cardPad" style={{ display: "grid", gap: 10 }}>
                  <strong>Ingresos por tipo de plan</strong>
                  <Pie
                    a={metrics.json?.breakdown?.revenueByPlanTypeInCents?.manual_link || 0}
                    b={metrics.json?.breakdown?.revenueByPlanTypeInCents?.auto_subscription || 0}
                    aLabel="Link"
                    bLabel="Auto"
                  />
                  <div className="grid2" style={{ gap: 8 }}>
                    <div className="card cardPad" style={{ padding: 10 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>MRR (auto)</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>${fmtMoneyCop(metrics.json?.totals?.auto?.mrrInCents || 0)} COP</div>
                    </div>
                    <div className="card cardPad" style={{ padding: 10 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Churn mensual (auto)</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>{fmtPct(metrics.json?.totals?.auto?.churnMonthlyPct)}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid2">
                <div className="card cardPad" style={{ display: "grid", gap: 8 }}>
                  <strong>Suscripciones activas (línea)</strong>
                  <ChartLine values={activeSubs} />
                </div>

                <div className="card cardPad" style={{ display: "grid", gap: 10 }}>
                  <strong>Suscripción automática</strong>
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
                      <ChartLine values={mrrSeries.map((v) => Number(v ?? 0))} />
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
