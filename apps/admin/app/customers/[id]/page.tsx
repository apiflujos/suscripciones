import Link from "next/link";
import { fetchAdminCached, getAdminApiConfig } from "../../lib/adminApi";
import { LocalDateTime } from "../../ui/LocalDateTime";
import { TimelineScroller } from "../../ui/TimelineScroller";
import { MapModal } from "../../ui/MapModal";

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

function tierForCustomer(approvedCount: number, hasSubscriptions: boolean, hasPayments: boolean) {
  if (!hasSubscriptions && !hasPayments) {
    return { label: "Potencial", cls: "tier-new", icon: "spark" };
  }
  if (!hasSubscriptions && hasPayments) {
    return { label: "Activo (links)", cls: "tier-active", icon: "link" };
  }
  if (approvedCount >= 6) return { label: "Oro", cls: "tier-gold", icon: "crown" };
  if (approvedCount >= 3) return { label: "Plata", cls: "tier-silver", icon: "medal" };
  if (approvedCount >= 1) return { label: "Bronce", cls: "tier-bronze", icon: "badge" };
  return { label: "Potencial", cls: "tier-new", icon: "spark" };
}

function tierIcon(type: string) {
  if (type === "crown") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 18h18v3H3zM5 6l4 4 3-6 3 6 4-4 2 10H3z" />
      </svg>
    );
  }
  if (type === "medal") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 2h4l1 4-4 7-3-6zM13 2h4l2 5-3 6-4-7zM12 11a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
      </svg>
    );
  }
  if (type === "badge") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2l3 4 5 1-3 4 1 5-6-2-6 2 1-5-3-4 5-1z" />
      </svg>
    );
  }
  if (type === "link") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10.5 13.5l3-3M7 17a4 4 0 0 1 0-6l3-3a4 4 0 0 1 6 6l-1 1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l2.4 6.4L21 9l-5 4 1.8 6-5.8-3.6L6.2 19 8 13 3 9l6.6-.6z" />
    </svg>
  );
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

function epochToIso(value: any) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const ms = num > 1_000_000_000_000 ? num : num * 1000;
  return new Date(ms).toISOString();
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

function MiniDonut({
  items,
  totalLabel
}: {
  items: Array<{ label: string; value: number; color: string }>;
  totalLabel: string;
}) {
  const total = items.reduce((acc, item) => acc + item.value, 0);
  if (!total) return <div className="muted">Sin datos para graficar.</div>;
  const size = 120;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", height: 140 }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} />
      {items.map((item, idx) => {
        if (!item.value) return null;
        const dash = (item.value / total) * circumference;
        const strokeDasharray = `${dash} ${circumference - dash}`;
        const circle = (
          <circle
            key={item.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={item.color}
            strokeWidth={stroke}
            strokeDasharray={strokeDasharray}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += dash;
        return circle;
      })}
      <text x="50%" y="48%" textAnchor="middle" fontSize="12" fill="var(--text-faint)">
        {totalLabel}
      </text>
      <text x="50%" y="62%" textAnchor="middle" fontSize="16" fill="var(--text)" fontWeight="700">
        {total}
      </text>
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

async function fetchChatwootConversations(contactId: number) {
  return fetchAdminCached(`/admin/chatwoot/contacts/${contactId}/conversations`, { ttlMs: 1500 });
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
  const logsTake = 20;
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
  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE" || s.status === "PAST_DUE");
  const lastPaymentAt = lastPayment?.paidAt || lastPayment?.createdAt || null;
  const meta = customer?.metadata || {};
  const nextPeriodEnd = activeSub?.currentPeriodEndAt || null;
  const paymentSourceId = meta?.wompi?.paymentSourceId || meta?.wompi?.payment_source_id || null;
  const chatwootContactId = Number(meta?.chatwoot?.contactId || 0);

  const amountSeries = payments
    .slice(0, 12)
    .reverse()
    .map((p) => Number(p.status === "APPROVED" ? p.amountInCents || 0 : 0));

  const approvedSorted = approvedPayments
    .map((p) => ({
      ...p,
      _at: new Date(p.paidAt || p.createdAt).getTime()
    }))
    .filter((p) => Number.isFinite(p._at))
    .sort((a, b) => a._at - b._at);
  const paymentIntervals = approvedSorted.slice(1).map((p, idx) => {
    const prev = approvedSorted[idx];
    return (p._at - prev._at) / (1000 * 60 * 60 * 24);
  });
  const avgDaysBetween = paymentIntervals.length
    ? paymentIntervals.reduce((acc, v) => acc + v, 0) / paymentIntervals.length
    : null;
  const cadenceSeries = paymentIntervals.slice(-6);
  const cadenceItems = cadenceSeries.map((v, idx) => ({
    label: `-${cadenceSeries.length - idx}`,
    value: Math.max(0, Math.round(v)),
    color: "var(--chart-b)"
  }));
  const daysSinceLast = lastPaymentAt ? Math.floor((Date.now() - new Date(lastPaymentAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
  const avgTicket = approvedPayments.length ? Math.round(totalPaidCents / approvedPayments.length) : 0;
  const approvedLast30 = approvedPayments.filter((p) => {
    const at = new Date(p.paidAt || p.createdAt).getTime();
    if (!Number.isFinite(at)) return false;
    return at >= Date.now() - 30 * 24 * 60 * 60 * 1000;
  }).length;

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

  const tier = tierForCustomer(approvedPayments.length, subscriptions.length > 0, payments.length > 0);

  const monthLabels = Array.from({ length: 6 }).map((_, idx) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - idx));
    return d.toLocaleDateString("es-CO", { month: "short" });
  });
  const monthlyCounts = monthLabels.map(() => 0);
  approvedPayments.forEach((p) => {
    const created = new Date(p.createdAt);
    if (!Number.isFinite(created.getTime())) return;
    const d = new Date();
    const diffMonths = (d.getFullYear() - created.getFullYear()) * 12 + (d.getMonth() - created.getMonth());
    if (diffMonths < 0 || diffMonths > 5) return;
    monthlyCounts[5 - diffMonths] += 1;
  });

  const logCounts = logs.reduce(
    (acc: { info: number; warn: number; error: number }, l: any) => {
      const lvl = String(l.level || "").toUpperCase();
      if (lvl === "ERROR") acc.error += 1;
      else if (lvl === "WARN" || lvl === "WARNING") acc.warn += 1;
      else acc.info += 1;
      return acc;
    },
    { info: 0, warn: 0, error: 0 }
  );

  const chatwootRes = chatwootContactId ? await fetchChatwootConversations(chatwootContactId) : null;
  const chatwootConvos = chatwootRes?.ok && Array.isArray(chatwootRes.json?.payload) ? chatwootRes.json.payload : [];
  const chatwootConvosSorted = [...chatwootConvos].sort((a, b) => {
    const aT = Number(a?.last_activity_at || a?.updated_at || a?.created_at || 0);
    const bT = Number(b?.last_activity_at || b?.updated_at || b?.created_at || 0);
    return bT - aT;
  });
  const chatwootRecent = chatwootConvosSorted.slice(0, 3);
  const chatwootStatusCounts = chatwootConvos.reduce(
    (acc: { open: number; pending: number; resolved: number; snoozed: number }, c: any) => {
      const st = String(c?.status || "").toLowerCase();
      if (st === "resolved") acc.resolved += 1;
      else if (st === "pending") acc.pending += 1;
      else if (st === "snoozed") acc.snoozed += 1;
      else acc.open += 1;
      return acc;
    },
    { open: 0, pending: 0, resolved: 0, snoozed: 0 }
  );
  const chatwootLastActivity = chatwootConvosSorted[0]?.last_activity_at || chatwootConvosSorted[0]?.updated_at || null;

  return (
    <main className="page">
      <section className="card cardPad customer-hero">
        <div className="customer-hero-meta">
          <div className="hero-head">
            <div className="hero-name-block">
              <div className="hero-name-row">
                <div className="contact-title">{customer.name || customer.email || customer.phone || "Contacto"}</div>
              </div>
              <div className="contact-subline">{customer.email || "—"} · {customer.phone || "—"}</div>
              <div className="contact-subline">
                ID <span className="mono">{customer.id}</span>
              </div>
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
            <div className="hero-right">
              <div className="hero-id-block">
                <span className="hero-id-label">NIT / ID</span>
                <span className="hero-id-value mono">{meta?.identificacion || meta?.identificationNumber || meta?.documentNumber || "—"}</span>
                <span className="hero-id-sub">{tenantName || customer.tenantId || "—"}</span>
              </div>
              {geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) ? (
                <MapModal
                  lat={geo.lat}
                  lon={geo.lon}
                  label={addressDisplay || undefined}
                  mapLink={mapLink || undefined}
                  triggerLabel="Ubicación"
                  triggerClassName="ghost btn-compact btn-blue"
                />
              ) : (
                <button type="button" className="ghost btn-compact" disabled>
                  Ubicación
                </button>
              )}
              <div className={`tier-badge tier-badge-hero ${tier.cls}`}>
                <span className="tier-icon" aria-hidden="true">
                  {tierIcon(tier.icon)}
                </span>
                <div className="tier-text">
                  <span className="tier-label">Nivel</span>
                  <span className="tier-value">{tier.label}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="customer-hero-actions">
          <div className="hero-actions-row">
            <Link className="ghost btn-compact btn-blue" href="/customers">Volver</Link>
            <Link className="ghost btn-compact btn-amber" href={`/customers/${customer.id}/payment-method`}>Método de pago</Link>
          </div>
          <div className="hero-subs hero-subs-block hero-subs-actions">
            <span className="hero-subs-label">Suscripciones activas</span>
            <div className="hero-subs-list">
              {activeSubs.length ? (
                activeSubs.slice(0, 3).map((s: any) => (
                  <span key={s.id} className={`pill pill-sm ${statusPillClass(String(s.status || ""))}`}>
                    {s.plan?.name || "Plan"} · {statusLabel(String(s.status || ""))}
                  </span>
                ))
              ) : (
                <span className="pill pill-muted pill-sm">Sin suscripciones activas</span>
              )}
            </div>
          </div>
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
        <div className="card cardPad customer-section customer-dual-card">
          <div className="customer-dual">
            <div className="customer-pane">
              <div className="contact-section-title">Información del cliente</div>
              <div className="invoice-header invoice-compact">
                <div className="invoice-top">
                  <div className="invoice-title">Datos de facturación</div>
                  <div className="invoice-id">
                    <span className="invoice-label">NIT / ID</span>
                    <span className="invoice-value mono">{meta?.identificacion || meta?.identificationNumber || meta?.documentNumber || "—"}</span>
                  </div>
                </div>
                <div className="invoice-row compact">
                  <div className="invoice-kv">
                    <span className="invoice-label">Email</span>
                    <span className="invoice-value truncate">{customer.email || "—"}</span>
                  </div>
                  <div className="invoice-kv">
                    <span className="invoice-label">Teléfono</span>
                    <span className="invoice-value">{customer.phone || "—"}</span>
                  </div>
                  <div className="invoice-kv">
                    <span className="invoice-label">Canal</span>
                    <span className="invoice-value">{tenantName || customer.tenantId || "—"}</span>
                  </div>
                  <div className="invoice-kv">
                    <span className="invoice-label">Creado</span>
                    <span className="invoice-value"><LocalDateTime value={customer.createdAt} /></span>
                  </div>
                </div>
                <div className="invoice-address">
                  <span className="invoice-label">Dirección</span>
                  <span className="invoice-value">{addressDisplay || "—"}</span>
                </div>
              </div>
            </div>

            <div className="customer-pane">
              <div className="contact-section-title">Estado comercial</div>
              <div className="summary-grid plain">
                <div className="summary-item summary-span-2">
                  <span className="summary-label">Plan activo</span>
                  <span className="summary-value">{activeSub?.plan?.name || "Sin plan activo"}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Tipo</span>
                  <span className="summary-value">{activeSub ? collectionLabel(String(activeSub?.plan?.collectionMode || activeSub?.plan?.metadata?.collectionMode || "")) : "—"}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Estado</span>
                  <span className="summary-value">{activeSub ? statusLabel(String(activeSub.status || "")) : "—"}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Último pago</span>
                  <span className="summary-value">{lastPaymentAt ? <LocalDateTime value={lastPaymentAt} /> : "—"}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Próximo corte</span>
                  <span className="summary-value">{nextPeriodEnd ? <LocalDateTime value={nextPeriodEnd} /> : "—"}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Método</span>
                  <span className="summary-value">{paymentSourceId ? "Tokenizado" : "Sin token"}</span>
                </div>
                <div className="summary-item summary-span-2">
                  <span className="summary-label">ID token</span>
                  <span className="summary-value mono">{paymentSourceId ? String(paymentSourceId) : "—"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid3">
        <div className="card cardPad chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Pagos recientes y por mes</div>
              <div className="chart-sub">Últimos 12 aprobados + últimos 6 meses.</div>
            </div>
            <div className="chart-range">{approvedPayments.length} aprobados</div>
          </div>
          <div className="chart-split">
            <div>
              <div className="chart-mini-label">Recientes</div>
              <MiniLine values={amountSeries} formatValue={formatCopFromCents} />
            </div>
            <div>
              <div className="chart-mini-label">Por mes</div>
              <MiniBars
                items={monthLabels.map((label, idx) => ({
                  label,
                  value: monthlyCounts[idx],
                  color: "var(--chart-a)"
                }))}
              />
            </div>
          </div>
          <div className="chart-kpis">
            <span className="chart-kpi">Total <strong>{formatCopFromCents(totalPaidCents)}</strong></span>
            <span className="chart-kpi">Promedio <strong>{formatCopFromCents(approvedPayments.length ? Math.round(totalPaidCents / approvedPayments.length) : 0)}</strong></span>
            <span className="chart-kpi">Pagos 6m <strong>{monthlyCounts.reduce((a, b) => a + b, 0)}</strong></span>
          </div>
        </div>

        <div className="card cardPad chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Estado de pagos</div>
              <div className="chart-sub">Distribución del historial reciente.</div>
            </div>
          </div>
          <div className="chart-donut">
            <MiniDonut
              totalLabel="Pagos"
              items={[
                { label: "Aprobados", value: approvedPayments.length, color: "var(--status-success)" },
                { label: "Pendientes", value: pendingPayments.length, color: "var(--status-warning)" },
                { label: "Fallidos", value: failedPayments.length, color: "var(--status-danger)" }
              ]}
            />
          </div>
          <div className="chart-legend">
            <span><i style={{ background: "var(--status-success)" }} />Aprobados {approvedPayments.length}</span>
            <span><i style={{ background: "var(--status-warning)" }} />Pendientes {pendingPayments.length}</span>
            <span><i style={{ background: "var(--status-danger)" }} />Fallidos {failedPayments.length}</span>
          </div>
        </div>

        <div className="card cardPad chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Actividad operativa</div>
              <div className="chart-sub">Logs recientes del cliente.</div>
            </div>
          </div>
          <div className="chart-donut">
            <MiniDonut
              totalLabel="Eventos"
              items={[
                { label: "Info", value: logCounts.info, color: "var(--chart-b)" },
                { label: "Alertas", value: logCounts.warn, color: "var(--status-warning)" },
                { label: "Errores", value: logCounts.error, color: "var(--status-danger)" }
              ]}
            />
          </div>
          <div className="chart-legend">
            <span><i style={{ background: "var(--chart-b)" }} />Info {logCounts.info}</span>
            <span><i style={{ background: "var(--status-warning)" }} />Alertas {logCounts.warn}</span>
            <span><i style={{ background: "var(--status-danger)" }} />Errores {logCounts.error}</span>
          </div>
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section">
          <div className="contact-section-title">KPIs comerciales</div>
          <div className="summary-grid compact">
            <div className="summary-item">
              <span className="summary-label">LTV</span>
              <span className="summary-value">{formatCopFromCents(totalPaidCents)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Ticket promedio</span>
              <span className="summary-value">{formatCopFromCents(avgTicket)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Frecuencia pago</span>
              <span className="summary-value">{avgDaysBetween == null ? "—" : `${Math.round(avgDaysBetween)} días`}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Recencia</span>
              <span className="summary-value">{daysSinceLast == null ? "—" : `${daysSinceLast} días`}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Aprobados 30 días</span>
              <span className="summary-value">{approvedLast30}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Total pagos</span>
              <span className="summary-value">{payments.length}</span>
            </div>
          </div>
          <div className="kpi-mini-grid">
            <div className="kpi-mini-card">
              <div className="kpi-mini-title">Estado de pagos</div>
              <MiniDonut
                totalLabel="Pagos"
                items={[
                  { label: "Aprobados", value: approvedPayments.length, color: "var(--status-success)" },
                  { label: "Pendientes", value: pendingPayments.length, color: "var(--status-warning)" },
                  { label: "Fallidos", value: failedPayments.length, color: "var(--status-danger)" }
                ]}
              />
            </div>
            {cadenceItems.length ? (
              <div className="kpi-mini-card">
                <div className="kpi-mini-title">Cadencia de pagos (días)</div>
                <MiniBars items={cadenceItems} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="card cardPad customer-section">
          <div className="contact-section-title">Chatwoot</div>
          {!chatwootContactId ? (
            <div className="muted">Sin contacto vinculado en Chatwoot.</div>
          ) : (
            <>
              <div className="summary-grid compact">
                <div className="summary-item">
                  <span className="summary-label">Conversaciones</span>
                  <span className="summary-value">{chatwootConvos.length}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Abiertas</span>
                  <span className="summary-value">{chatwootStatusCounts.open}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Pendientes</span>
                  <span className="summary-value">{chatwootStatusCounts.pending}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Última actividad</span>
                  <span className="summary-value">{chatwootLastActivity ? <LocalDateTime value={epochToIso(chatwootLastActivity) || ""} /> : "—"}</span>
                </div>
              </div>
              {chatwootRecent.length ? (
                <div className="chatwoot-list">
                  {chatwootRecent.map((c: any) => (
                    <div key={c.id} className="chatwoot-item">
                      <div className="chatwoot-item-title">
                        Conversación #{c.id}
                        <span className={`pill pill-sm ${c.status === "resolved" ? "pill-ok" : c.status === "pending" ? "pill-warn" : "pill-muted"}`}>
                          {String(c.status || "open")}
                        </span>
                      </div>
                      <div className="chatwoot-item-meta">
                        <span>Inbox {c.inbox_id || "—"}</span>
                        <span>Canal {c.inbox?.name || "—"}</span>
                        <span>{c.last_activity_at ? <LocalDateTime value={epochToIso(c.last_activity_at) || ""} /> : "—"}</span>
                      </div>
                      {c.last_message?.content || c.messages?.[0]?.content ? (
                        <div className="chatwoot-item-snippet">
                          {String(c.last_message?.content || c.messages?.[0]?.content || "").slice(0, 140)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">Sin conversaciones recientes.</div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section timeline-full">
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
        <div className="card cardPad customer-section timeline-full">
          <div className="contact-section-title">Línea de tiempo del cliente</div>
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
            <div className="timeline-scroll">
              <TimelineScroller ariaLabel="Línea de tiempo del cliente">
                <div className="customer-log-list" role="list">
                {logs.map((l: any) => (
                  <div
                    key={l.id}
                    className="customer-log-item"
                    role="listitem"
                    tabIndex={0}
                    data-tooltip={`${l.entity || "Evento del cliente"}\n${new Date(l.createdAt).toLocaleString("es-CO")} · ${logLevelLabel(String(l.level || ""))}\n${l.actor || "Sistema"}${l.source ? ` · ${l.source}` : ""}`}
                  >
                    <div className="customer-log-title">{l.entity || "Evento del cliente"}</div>
                    <div className="customer-log-meta">
                      <span>{l.actor || "Sistema"}</span>
                      <span><LocalDateTime value={l.createdAt} /></span>
                      <span className={`pill pill-sm ${logPillClass(String(l.level || ""))}`}>{logLevelLabel(String(l.level || ""))}</span>
                      {l.source ? <span>{l.source}</span> : null}
                    </div>
                    <div className="customer-log-message">{l.message}</div>
                  </div>
                ))}
                </div>
              </TimelineScroller>
            </div>
          ) : (
            <div className="muted">Sin logs en este periodo.</div>
          )}
        </div>
      </section>
    </main>
  );
}
