import Link from "next/link";
import { fetchAdminCached, getAdminApiConfig } from "../../lib/adminApi";
import { LocalDateTime } from "../../ui/LocalDateTime";
import { LeafletMap } from "../../ui/LeafletMap";

export const dynamic = "force-dynamic";

function formatCopFromCents(cents: number) {
  const pesos = Math.trunc(Number(cents || 0) / 100);
  if (!Number.isFinite(pesos)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

function statusLabel(status: string) {
  if (!status) return "—";
  if (status === "ACTIVE") return "Activa";
  if (status === "PAST_DUE") return "En mora";
  if (status === "PENDING") return "Pendiente";
  if (status === "APPROVED") return "Aprobado";
  if (status === "DECLINED" || status === "ERROR" || status === "VOIDED") return "Fallido";
  return status;
}

function statusPillClass(status: string) {
  if (status === "ACTIVE" || status === "APPROVED") return "pill-ok";
  if (status === "PAST_DUE" || status === "DECLINED" || status === "ERROR" || status === "VOIDED") return "pill-bad";
  if (status === "PENDING") return "pill-muted";
  return "pill-muted";
}

function logLevelLabel(level: string) {
  const upper = String(level || "").toUpperCase();
  if (!upper) return "—";
  if (upper === "ERROR") return "Error";
  if (upper === "WARN" || upper === "WARNING") return "Alerta";
  if (upper === "INFO") return "Info";
  return upper;
}

function logPillClass(level: string) {
  const upper = String(level || "").toUpperCase();
  if (upper === "ERROR") return "pill-bad";
  if (upper === "WARN" || upper === "WARNING") return "pill-warn";
  if (upper === "INFO") return "pill-muted";
  return "pill-muted";
}

function collectionLabel(mode: string) {
  if (mode === "AUTO_DEBIT") return "Suscripción";
  if (mode === "AUTO_LINK") return "Plan auto";
  return "Plan";
}

function MiniLine({ values, formatValue }: { values: number[]; formatValue?: (value: number) => string }) {
  if (!values.length) return <div className="muted">Sin datos para graficar.</div>;
  const w = 260;
  const h = 90;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const lastValue = values[values.length - 1] ?? 0;
  const fmt = formatValue || ((value: number) => String(value));
  const gridY = [0, 0.25, 0.5, 0.75, 1];
  const gridX = [0, 0.25, 0.5, 0.75, 1];
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 120 }}>
      {gridY.map((t) => (
        <line key={`gy-${t}`} x1="0" y1={h * t} x2={w} y2={h * t} stroke="var(--chart-track)" strokeDasharray="3 4" />
      ))}
      {gridX.map((t) => (
        <line key={`gx-${t}`} x1={w * t} y1="0" x2={w * t} y2={h} stroke="var(--chart-track)" strokeDasharray="3 4" />
      ))}
      <polyline points={pts.join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" />
      {values.length > 1 ? (
        <circle cx={w} cy={h - ((lastValue - min) / range) * h} r="3.5" fill="var(--primary)" />
      ) : null}
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="var(--chart-axis)" />
      <text x="2" y="10" fontSize="10" fill="var(--text-faint)">{fmt(max)}</text>
      <text x="2" y={h - 4} fontSize="10" fill="var(--text-faint)">{fmt(min)}</text>
    </svg>
  );
}

function MiniBars({ items }: { items: Array<{ label: string; value: number; color: string }> }) {
  if (!items.length) return <div className="muted">Sin datos para graficar.</div>;
  const w = 260;
  const h = 90;
  const max = Math.max(...items.map((i) => i.value)) || 1;
  const gridY = [0, 0.25, 0.5, 0.75, 1];
  const gap = 12;
  const barW = (w - gap * (items.length - 1)) / items.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 120 }}>
      {gridY.map((t) => (
        <line key={`gby-${t}`} x1="0" y1={h * t} x2={w} y2={h * t} stroke="var(--chart-track)" strokeDasharray="3 4" />
      ))}
      {items.map((item, idx) => {
        const barH = (item.value / max) * (h - 18);
        const x = idx * (barW + gap);
        return (
          <g key={item.label}>
            <rect x={x} y={h - barH - 12} width={barW} height={barH} fill={item.color} rx="4" />
            <text x={x + barW / 2} y={h - barH - 18} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
              {item.value}
            </text>
            <text x={x + barW / 2} y={h - 2} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
              {item.label}
            </text>
          </g>
        );
      })}
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="var(--chart-axis)" />
    </svg>
  );
}

async function fetchCustomer(id: string) {
  return fetchAdminCached(`/admin/customers/${encodeURIComponent(id)}`, { ttlMs: 1500 });
}

async function fetchPayments(id: string) {
  return fetchAdminCached(`/admin/customers/${encodeURIComponent(id)}/payments?take=40`, { ttlMs: 1500 });
}

async function fetchSubscriptions(id: string) {
  return fetchAdminCached(`/admin/subscriptions?customerId=${encodeURIComponent(id)}&take=40`, { ttlMs: 1500 });
}

async function fetchLogs(id: string, opts?: { take?: number; from?: string; to?: string }) {
  const params = new URLSearchParams({
    customerId: id,
    take: String(opts?.take ?? 20),
    ...(opts?.from ? { from: opts.from } : {}),
    ...(opts?.to ? { to: opts.to } : {})
  });
  return fetchAdminCached(`/admin/logs/system?${params.toString()}`, { ttlMs: 1500 });
}

async function fetchTenants() {
  return fetchAdminCached("/admin/tenants", { ttlMs: 1500 });
}

async function geocodeAddress(address: string) {
  if (!address) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "apiflujos-admin/1.0 (contacto@apiflujos.com)"
      },
      cache: "no-store"
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => []);
    const first = Array.isArray(json) ? json[0] : null;
    if (!first) return null;
    return {
      lat: Number(first.lat),
      lon: Number(first.lon),
      label: String(first.display_name || "")
    };
  } catch {
    return null;
  }
}

export default async function CustomerDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = getAdminApiConfig();
  if (!token) {
    return (
      <main className="page">
        <div className="card cardPad">Configura `ADMIN_API_TOKEN` para consultar contactos.</div>
      </main>
    );
  }

  const { id } = await params;
  const rawSearch = (await searchParams) || {};
  const logsPage = Math.max(1, Number(rawSearch.logsPage ?? 1));
  const logsWindowDays = 30;
  const logsTo = new Date();
  logsTo.setDate(logsTo.getDate() - logsWindowDays * (logsPage - 1));
  const logsFrom = new Date();
  logsFrom.setDate(logsFrom.getDate() - logsWindowDays * logsPage);
  const logsTake = 12;
  const [customerRes, paymentsRes, subscriptionsRes, logsRes, tenantsRes] = await Promise.all([
    fetchCustomer(id),
    fetchPayments(id),
    fetchSubscriptions(id),
    fetchLogs(id, { take: logsTake, from: logsFrom.toISOString(), to: logsTo.toISOString() }),
    fetchTenants()
  ]);

  if (!customerRes.ok) {
    return (
      <main className="page">
        <div className="card cardPad">No encontramos el contacto solicitado.</div>
        <Link className="ghost btn-compact" href="/customers">Volver a contactos</Link>
      </main>
    );
  }

  const customer = customerRes.json?.customer || null;
  if (!customer) {
    return (
      <main className="page">
        <div className="card cardPad">No encontramos el contacto solicitado.</div>
        <Link className="ghost btn-compact" href="/customers">Volver a contactos</Link>
      </main>
    );
  }

  const payments = (paymentsRes.json?.items ?? []) as any[];
  const subscriptions = (subscriptionsRes.json?.items ?? []) as any[];
  const logs = (logsRes.json?.items ?? []) as any[];
  const tenants = (tenantsRes.json?.items ?? []) as Array<{ id: string; name: string }>;
  const tenantName = tenants.find((t) => String(t.id) === String(customer.tenantId))?.name || "";

  const approvedPayments = payments.filter((p) => p.status === "APPROVED");
  const failedPayments = payments.filter((p) => ["DECLINED", "ERROR", "VOIDED"].includes(String(p.status)));
  const pendingPayments = payments.filter((p) => p.status === "PENDING");
  const totalPaidCents = approvedPayments.reduce((acc, p) => acc + Number(p.amountInCents || 0), 0);
  const lastPayment = payments[0] || null;
  const activeSub = subscriptions.find((s) => s.status === "ACTIVE" || s.status === "PAST_DUE") || subscriptions[0] || null;
  const lastPaymentAt = lastPayment?.paidAt || lastPayment?.createdAt || null;
  const meta = customer?.metadata || {};
  const nextPeriodEnd = activeSub?.currentPeriodEndAt || null;
  const paymentSourceId = meta?.wompi?.paymentSourceId || meta?.wompi?.payment_source_id || null;

  const amountSeries = payments
    .slice(0, 12)
    .reverse()
    .map((p) => Number(p.status === "APPROVED" ? p.amountInCents || 0 : 0));

  const addressParts = [
    customer?.metadata?.address?.line1,
    customer?.metadata?.address?.city,
    customer?.metadata?.address?.dept,
    customer?.metadata?.address?.code5
  ].filter(Boolean);
  const addressLabel = addressParts.join(", ");
  const directLat = Number(meta?.address?.lat ?? meta?.geo?.lat ?? meta?.location?.lat);
  const directLon = Number(meta?.address?.lon ?? meta?.address?.lng ?? meta?.geo?.lon ?? meta?.geo?.lng ?? meta?.location?.lon ?? meta?.location?.lng);
  const geo =
    Number.isFinite(directLat) && Number.isFinite(directLon)
      ? { lat: directLat, lon: directLon, label: addressLabel }
      : await geocodeAddress(addressLabel);

  const addressDisplay = geo?.label || addressLabel || "";
  const mapLink =
    geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)
      ? `https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=15/${geo.lat}/${geo.lon}`
      : "";

  const recentPayments = payments.slice(0, 5);
  const formatWindowLabel = (fromDate: Date, toDate: Date) =>
    `${fromDate.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })} - ${toDate.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}`;

  return (
    <main className="page">
      <section className="card cardPad customer-hero">
        <div className="customer-hero-meta">
          <div className="contact-title">{customer.name || customer.email || customer.phone || "Contacto"}</div>
          <div className="contact-subline">{customer.email || "—"} · {customer.phone || "—"}</div>
          <div className="contact-subline">ID: <span className="mono">{customer.id}</span></div>
          <div className="contact-tags">
            {meta?.wompi?.paymentSourceId || meta?.wompi?.payment_source_id ? (
              <span className="pill pill-ok pill-sm">Tokenizada</span>
            ) : (
              <span className="pill pill-bad pill-sm">Sin token</span>
            )}
            {activeSub ? (
              <span className={`pill pill-sm ${statusPillClass(String(activeSub.status || ""))}`}>
                {collectionLabel(String(activeSub?.plan?.collectionMode || activeSub?.plan?.metadata?.collectionMode || ""))} · {statusLabel(String(activeSub.status || ""))}
              </span>
            ) : (
              <span className="pill pill-muted pill-sm">Sin suscripciones</span>
            )}
          </div>
        </div>
        <div className="customer-hero-actions">
          <Link className="ghost btn-compact" href="/customers">Volver</Link>
          <Link className="ghost btn-compact" href={`/customers/${customer.id}/payment-method`}>Método de pago</Link>
        </div>
      </section>

      <section className="grid3">
        <div className="card cardPad metric-card tone-primary">
          <div className="metric-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1v22M5 6h10a4 4 0 0 1 0 8H7a4 4 0 0 0 0 8h10" />
            </svg>
          </div>
          <div className="metric-label">Pagos aprobados</div>
          <div className="metric-value">{approvedPayments.length}</div>
          <div className="metric-sub">{formatCopFromCents(totalPaidCents)} acumulado</div>
        </div>
        <div className="card cardPad metric-card tone-info">
          <div className="metric-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 8v4l3 3" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <div className="metric-label">Último movimiento</div>
          <div className="metric-value">{lastPaymentAt ? <LocalDateTime value={lastPaymentAt} /> : "—"}</div>
          <div className="metric-sub">{lastPayment ? `Estado ${statusLabel(lastPayment.status)}` : "Sin pagos aún"}</div>
        </div>
        <div className="card cardPad metric-card tone-warning">
          <div className="metric-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l9 5v10l-9 5-9-5V7z" />
            </svg>
          </div>
          <div className="metric-label">Suscripciones</div>
          <div className="metric-value">{subscriptions.length}</div>
          <div className="metric-sub">{activeSub ? activeSub.plan?.name || "Plan activo" : "Sin plan activo"}</div>
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section">
          <div className="contact-section-title">Información del cliente</div>
          <div className="contact-person-grid">
            <div>
              <span>Email</span>
              <span className="contact-value">{customer.email || "—"}</span>
            </div>
            <div>
              <span>Teléfono</span>
              <span className="contact-value">{customer.phone || "—"}</span>
            </div>
            <div>
              <span>Identificación</span>
              <span className="contact-value">{meta?.identificacion || meta?.identificationNumber || meta?.documentNumber || "—"}</span>
            </div>
            <div>
              <span>Canal</span>
              <span className="contact-value">{tenantName || customer.tenantId || "—"}</span>
            </div>
            <div>
              <span>Creado</span>
              <span className="contact-value"><LocalDateTime value={customer.createdAt} /></span>
            </div>
            <div>
              <span>Dirección</span>
              <span className="contact-value">{addressLabel || "—"}</span>
            </div>
          </div>
        </div>

        <div className="card cardPad customer-section">
          <div className="contact-section-title">Estado comercial</div>
          <div className="contact-plan-grid">
            <div>
              <span>Plan activo</span>
              <strong className="contact-value">{activeSub?.plan?.name || "Sin plan activo"}</strong>
            </div>
            <div>
              <span>Tipo</span>
              <strong className="contact-value">{activeSub ? collectionLabel(String(activeSub?.plan?.collectionMode || activeSub?.plan?.metadata?.collectionMode || "")) : "—"}</strong>
            </div>
            <div>
              <span>Estado</span>
              <strong className="contact-value">{activeSub ? statusLabel(String(activeSub.status || "")) : "—"}</strong>
            </div>
            <div>
              <span>Último pago</span>
              <strong className="contact-value">{lastPaymentAt ? <LocalDateTime value={lastPaymentAt} /> : "—"}</strong>
            </div>
            <div>
              <span>Próximo corte</span>
              <strong className="contact-value">{nextPeriodEnd ? <LocalDateTime value={nextPeriodEnd} /> : "—"}</strong>
            </div>
            <div>
              <span>Método de pago</span>
              <strong className="contact-value">{paymentSourceId ? "Tokenizado" : "Sin token"}</strong>
            </div>
            <div>
              <span>ID token</span>
              <strong className="contact-value mono">{paymentSourceId ? String(paymentSourceId) : "—"}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Pagos aprobados recientes</div>
              <div className="chart-sub">Últimos 12 movimientos (solo aprobados).</div>
            </div>
            <div className="chart-range">{approvedPayments.length} aprobados</div>
          </div>
          <MiniLine values={amountSeries} formatValue={formatCopFromCents} />
          <div className="chart-kpis">
            <span className="chart-kpi">Total <strong>{formatCopFromCents(totalPaidCents)}</strong></span>
            <span className="chart-kpi">Promedio <strong>{formatCopFromCents(approvedPayments.length ? Math.round(totalPaidCents / approvedPayments.length) : 0)}</strong></span>
          </div>
        </div>

        <div className="card cardPad chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Estado de pagos</div>
              <div className="chart-sub">Distribución de los últimos movimientos.</div>
            </div>
          </div>
          <MiniBars
            items={[
              { label: "Aprobados", value: approvedPayments.length, color: "var(--status-success)" },
              { label: "Pendientes", value: pendingPayments.length, color: "var(--status-warning)" },
              { label: "Fallidos", value: failedPayments.length, color: "var(--status-danger)" }
            ]}
          />
          <div className="chart-kpis">
            <span className="chart-kpi">Fallidos <strong>{failedPayments.length}</strong></span>
            <span className="chart-kpi">Pendientes <strong>{pendingPayments.length}</strong></span>
          </div>
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section">
          <div className="contact-section-title">Suscripciones y planes</div>
          {subscriptions.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Tipo</th>
                    <th>Estado</th>
                    <th>Periodo</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((s: any) => {
                    const mode = String(s?.plan?.collectionMode || s?.plan?.metadata?.collectionMode || "MANUAL_LINK");
                    return (
                      <tr key={s.id}>
                        <td>{s.plan?.name || "—"}</td>
                        <td>{collectionLabel(mode)}</td>
                        <td><span className={`pill pill-sm ${statusPillClass(String(s.status || ""))}`}>{statusLabel(String(s.status || ""))}</span></td>
                        <td>
                          {s.currentPeriodStartAt || s.currentPeriodEndAt ? (
                            <div className="muted" style={{ display: "grid", gap: 2 }}>
                              {s.currentPeriodStartAt ? <span>Inicio: <LocalDateTime value={s.currentPeriodStartAt} /></span> : null}
                              {s.currentPeriodEndAt ? <span>Fin: <LocalDateTime value={s.currentPeriodEndAt} /></span> : null}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">Sin suscripciones registradas.</div>
          )}
        </div>

        <div className="card cardPad customer-section">
          <div className="contact-section-title">Pagos recientes</div>
          {recentPayments.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th>Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p: any) => (
                    <tr key={p.id}>
                      <td><LocalDateTime value={p.paidAt || p.createdAt} /></td>
                      <td>{formatCopFromCents(Number(p.amountInCents || 0))}</td>
                      <td><span className={`pill pill-sm ${statusPillClass(String(p.status || ""))}`}>{statusLabel(String(p.status || ""))}</span></td>
                      <td>{p.planName || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">Sin pagos registrados.</div>
          )}
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section">
          <div className="contact-section-title">Logs del cliente</div>
          <div className="customer-log-controls">
            <span className="muted">{formatWindowLabel(logsFrom, logsTo)}</span>
            <div className="customer-log-actions">
              <Link className="ghost btn-compact" href={`/customers/${customer.id}?logsPage=${logsPage + 1}`}>
                Mes anterior
              </Link>
              <Link className="ghost btn-compact" href={`/customers/${customer.id}?logsPage=${Math.max(1, logsPage - 1)}`} aria-disabled={logsPage <= 1}>
                Más reciente
              </Link>
            </div>
          </div>
          {logs.length ? (
            <div className="customer-log-list">
              {logs.map((l: any) => (
                <div key={l.id} className="customer-log-item">
                  <div className="customer-log-title">{l.entity || "Evento del cliente"}</div>
                  <div className="customer-log-meta">
                    <span>{l.actor || "Sistema"}</span>
                    <span><LocalDateTime value={l.createdAt} /></span>
                    <span className={`pill pill-sm ${logPillClass(String(l.level || ""))}`}>{logLevelLabel(String(l.level || ""))}</span>
                    {l.source ? <span>{l.source}</span> : null}
                  </div>
                  <div className="muted" style={{ marginTop: 6 }}>{l.message}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">Sin logs en este periodo.</div>
          )}
        </div>

        <div className="card cardPad customer-section">
          <div className="contact-section-title">Ubicación del cliente</div>
          <div className="customer-address">
            {addressDisplay ? (
              <div className="customer-address-meta">
                <div>Dirección registrada</div>
                <strong>{addressDisplay}</strong>
                {geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) ? (
                  <span className="muted">Coordenadas: {geo.lat.toFixed(5)}, {geo.lon.toFixed(5)}</span>
                ) : null}
              </div>
            ) : (
              <div className="muted">Sin dirección registrada.</div>
            )}
          </div>
          <div className="customer-map">
            {geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) ? (
              <LeafletMap lat={geo.lat} lon={geo.lon} label={addressDisplay || undefined} />
            ) : (
              <div className="muted" style={{ padding: 16 }}>Sin coordenadas disponibles.</div>
            )}
          </div>
          {mapLink ? (
            <a className="ghost btn-compact" href={mapLink} target="_blank" rel="noreferrer">
              Abrir en OpenStreetMap
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}
