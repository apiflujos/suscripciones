import Link from "next/link";
import { getCustomerWithGamification } from "../../admin/_services/customers";
import { getCustomerPayments, listCustomerBillingCycles } from "../../admin/_services/payments";
import { listSubscriptions } from "../../admin/_services/subscriptions";
import { listSystemLogs } from "../../admin/_services/logs";
import { listTenants } from "../../admin/_services/tenants";
import { getAdminSettings } from "../../admin/_services/settings";
import { listChatwootContactConversations } from "../../admin/_services/chatwoot";
import { resolveTenantId } from "../../admin/_services/tenantResolver";
import { AiAssistant } from "../../logs/AiAssistant";
import { LocalDateTime } from "../../ui/LocalDateTime";
import { TimelineScroller } from "../../ui/TimelineScroller";
import { MapModal } from "../../ui/MapModal";
import { isNoiseNotification, normalizeSystemText } from "../../lib/logPresentation";
import { extractCustomerPaymentSourceId, readCustomerMetadata } from "@suscripciones/core/lib/customerMetadata";

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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanLogEntity(raw: string, customerLabel: string) {
  let out = String(raw || "").trim();
  if (!out) return "Evento del cliente";
  out = out.replace(/^cliente\s*·\s*/i, "");
  out = out.replace(/^pago\s*·\s*/i, "Pago · ");
  if (customerLabel) {
    const safe = escapeRegex(customerLabel);
    out = out.replace(new RegExp(`\\s*·\\s*${safe}`, "ig"), "");
    out = out.replace(new RegExp(`\\b${safe}\\b`, "ig"), "");
  }
  out = out.replace(/\s+·\s+$/g, "").replace(/\s{2,}/g, " ").trim();
  return out || "Evento del cliente";
}

function cleanLogMessage(raw: string, customerLabel: string) {
  let out = normalizeSystemText(raw);
  if (!out) return "—";
  if (customerLabel) {
    const safe = escapeRegex(customerLabel);
    out = out.replace(new RegExp(`\\b${safe}\\b`, "ig"), "");
  }
  out = out.replace(/\s{2,}/g, " ").trim();
  return out || "—";
}

function isRelevantCustomerLog(log: any) {
  const source = String(log?.source || "").trim();
  const title = normalizeSystemText(log?.entity || "");
  const message = normalizeSystemText(log?.message || "");
  if (isNoiseNotification({ source, title, message })) return false;
  return true;
}

function compactCustomerLogs(items: any[]) {
  const dedup = new Map<string, any>();
  for (const item of items) {
    const key = `${String(item?.source || "").trim().toLowerCase()}|${normalizeSystemText(item?.entity || "").toLowerCase()}|${normalizeSystemText(item?.message || "").toLowerCase()}|${String(item?.level || "").toUpperCase()}`;
    const prev = dedup.get(key);
    if (!prev) {
      dedup.set(key, { ...item, duplicateCount: 1 });
      continue;
    }
    const prevTs = new Date(prev.createdAt || 0).getTime();
    const currTs = new Date(item?.createdAt || 0).getTime();
    const base = currTs >= prevTs ? item : prev;
    dedup.set(key, { ...base, duplicateCount: Number(prev?.duplicateCount || 1) + 1 });
  }
  return Array.from(dedup.values()).sort(
    (a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()
  );
}

function collectionLabel(mode: string) {
  if (mode === "AUTO_DEBIT") return "Débito automático";
  if (mode === "AUTO_LINK") return "Link de pago (auto)";
  return "Link de pago";
}

function normalizeSku(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

function formatPlanTitle(plan: any) {
  const md = (plan?.metadata as any) || {};
  const displayName = String(md?.displayName || "").trim();
  const rawName = String(plan?.name || "").trim();
  const cleanName = rawName.replace(/^\s*\[\d+\]\s*/, "").trim();
  const name = displayName || cleanName || "—";
  const sku = normalizeSku(md?.sku);
  return sku ? `SKU ${sku} · ${name}` : name;
}

function formatProductTitle(product: any, fallbackPlan?: any) {
  const displayName = String(product?.displayName || product?.name || "").trim();
  if (displayName) return displayName;
  return formatPlanTitle(fallbackPlan);
}

function tokenMethodLabel(meta: unknown) {
  const customerMeta = readCustomerMetadata(meta);
  const wompi = customerMeta.wompi || {};
  const sources = Array.isArray(wompi?.paymentSources) ? wompi.paymentSources : [];
  const activeId = Number(extractCustomerPaymentSourceId(customerMeta) ?? 0);
  const active =
    (Number.isFinite(activeId) && activeId > 0
      ? sources.find((src: any) => Number(src?.id) === activeId)
      : null) ||
    sources[0] ||
    null;
  if (!active && !Number.isFinite(activeId)) return "";
  const activeMeta = active && typeof active === "object" ? (active as Record<string, unknown>) : null;
  const activeCard = activeMeta?.card && typeof activeMeta.card === "object" ? (activeMeta.card as Record<string, unknown>) : null;
  const activePaymentMethod =
    activeMeta?.paymentMethod && typeof activeMeta.paymentMethod === "object"
      ? (activeMeta.paymentMethod as Record<string, unknown>)
      : null;
  const methodTypeRaw = String(active?.type || wompi?.paymentSourceType || "").trim().toUpperCase();
  const methodType =
    methodTypeRaw === "CARD" ? "Tarjeta" :
    methodTypeRaw === "NEQUI" ? "Nequi" :
    methodTypeRaw === "PSE" ? "PSE" :
    "Método";
  const brandRaw = String(
    activeMeta?.brand ||
    activeMeta?.cardBrand ||
    activeCard?.brand ||
    activePaymentMethod?.brand ||
    ""
  ).trim();
  const brand = brandRaw ? brandRaw.toUpperCase() : "";
  const last4Raw = String(
    activeMeta?.last4 ||
    activeMeta?.last_four ||
    activeCard?.last4 ||
    activeCard?.last_four ||
    activeMeta?.cardLast4 ||
    ""
  ).trim();
  const last4Digits = last4Raw.replace(/\D+/g, "");
  const last4 = last4Digits.length >= 4 ? last4Digits.slice(-4) : "";
  if (brand && last4) return `${methodType} ${brand} · •••• ${last4}`;
  if (last4) return `${methodType} · •••• ${last4}`;
  if (brand) return `${methodType} ${brand}`;
  if (Number.isFinite(activeId) && activeId > 0) return `${methodType} · fuente ${activeId}`;
  return methodType;
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

async function fetchCustomer(id: string, tenantId?: string | null) {
  return getCustomerWithGamification({ customerId: id, tenantId: tenantId || null });
}

async function fetchPayments(id: string, tenantId?: string | null) {
  return getCustomerPayments({ customerId: id, tenantId: tenantId || null, take: 40, skip: 0 });
}

async function fetchSubscriptions(id: string, tenantId?: string | null) {
  return listSubscriptions({ customerId: id, tenantId: tenantId || null, take: 40 });
}

async function fetchBillingCycles(id: string) {
  return listCustomerBillingCycles({ customerId: id, take: 30 });
}

async function fetchLogs(id: string, opts?: { take?: number; from?: string; to?: string }) {
  return listSystemLogs({
    customerId: id,
    take: opts?.take ?? 20,
    from: opts?.from,
    to: opts?.to
  });
}

async function fetchTenants() {
  return listTenants();
}

async function fetchSettings() {
  return getAdminSettings();
}

async function fetchChatwootConversations(contactId: number) {
  return listChatwootContactConversations(contactId);
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
  const { id } = await params;
  const resolvedTenantId = null;
  const rawSearch = (await searchParams) || {};
  const logsPage = Math.max(1, Number(rawSearch.logsPage ?? 1));
  const logsWindowDays = 30;
  const logsTo = new Date();
  logsTo.setDate(logsTo.getDate() - logsWindowDays * (logsPage - 1));
  const logsFrom = new Date();
  logsFrom.setDate(logsFrom.getDate() - logsWindowDays * logsPage);
  const logsTake = 20;
  const [customerRes, paymentsRes, subscriptionsRes, logsRes, tenantsRes, settingsRes, cyclesRes] = await Promise.all([
    fetchCustomer(id, resolvedTenantId),
    fetchPayments(id, resolvedTenantId),
    fetchSubscriptions(id, resolvedTenantId),
    fetchLogs(id, { take: logsTake, from: logsFrom.toISOString(), to: logsTo.toISOString() }),
    fetchTenants(),
    fetchSettings(),
    fetchBillingCycles(id)
  ]);

  if (!customerRes.ok) {
    return (
      <main className="page">
        <div className="card cardPad">No encontramos el contacto solicitado.</div>
        <Link className="ghost btn-compact" href="/customers">Volver a contactos</Link>
      </main>
    );
  }

  const customer = customerRes.ok ? customerRes.customer : null;
  if (!customer) {
    return (
      <main className="page">
        <div className="card cardPad">No encontramos el contacto solicitado.</div>
        <Link className="ghost btn-compact" href="/customers">Volver a contactos</Link>
      </main>
    );
  }

  const payments = (paymentsRes.ok ? paymentsRes.items : []) as any[];
  const subscriptions = (subscriptionsRes.items ?? []) as any[];
  const logsRaw = (logsRes.items ?? []) as any[];
  const logs = compactCustomerLogs(logsRaw.filter(isRelevantCustomerLog));
  const tenants = (tenantsRes ?? []) as Array<{ id: string; name: string }>;
  const billingCycles = (cyclesRes && (cyclesRes as any).ok ? (cyclesRes as any).items : []) as any[];
  const aiConfig = settingsRes?.ai || null;
  const aiProviders = aiConfig?.providers || null;
  const aiEnabled = Boolean(aiConfig?.enabled && (aiProviders?.openai?.configured || aiProviders?.deepseek?.configured));
  const tenantName = tenants.find((t) => String(t.id) === String(customer.tenantId))?.name || "";
  const tenantNameById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));

  const approvedPayments = payments.filter((p) => p.status === "APPROVED");
  const failedPayments = payments.filter((p) => ["DECLINED", "ERROR", "VOIDED"].includes(String(p.status)));
  const pendingPayments = payments.filter((p) => p.status === "PENDING");
  const totalPaidCents = approvedPayments.reduce((acc, p) => acc + Number(p.amountInCents || 0), 0);
  const lastPayment = payments[0] || null;
  const activeSub = subscriptions.find((s) => s.status === "ACTIVE") || subscriptions[0] || null;
  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE");
  const subscriptionStatusCounts = subscriptions.reduce(
    (acc, s) => {
      const key = String(s?.status || "UNKNOWN");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const subsActiveCount = subscriptionStatusCounts.ACTIVE || 0;
  const subsPastDueCount = subscriptionStatusCounts.PAST_DUE || 0;
  const subsCanceledCount =
    (subscriptionStatusCounts.CANCELED || 0) +
    (subscriptionStatusCounts.CANCELLED || 0) +
    (subscriptionStatusCounts.ENDED || 0);
  const subsOtherCount = Math.max(0, subscriptions.length - (subsActiveCount + subsPastDueCount + subsCanceledCount));
  const subscriptionStatusItems = [
    { label: "Activas", value: subsActiveCount, color: "var(--status-success)" },
    { label: "En mora", value: subsPastDueCount, color: "var(--status-warning)" },
    { label: "Cerradas", value: subsCanceledCount, color: "var(--chart-c)" },
    { label: "Otras", value: subsOtherCount, color: "var(--chart-b)" }
  ].filter((item) => item.value > 0);
  const lastPaymentAt = lastPayment?.paidAt || lastPayment?.createdAt || null;
  const meta = readCustomerMetadata(customer?.metadata);
  const nowTs = Date.now();
  const activeSubCycles = activeSub
    ? billingCycles
        .filter((cycle: any) => String(cycle?.subscriptionId || cycle?.subscription?.id || "") === String(activeSub.id))
        .sort((a: any, b: any) => new Date(b.periodStartAt || 0).getTime() - new Date(a.periodStartAt || 0).getTime())
    : [];
  const activeCycleForSummary =
    activeSubCycles.find((cycle: any) => {
      const startTs = new Date(cycle.periodStartAt || 0).getTime();
      const endTs = new Date(cycle.periodEndAt || 0).getTime();
      return Number.isFinite(startTs) && Number.isFinite(endTs) && startTs <= nowTs && nowTs < endTs;
    }) ||
    activeSubCycles.find((cycle: any) => new Date(cycle.periodStartAt || 0).getTime() <= nowTs) ||
    activeSubCycles[0] ||
    null;
  const nextPeriodEnd = activeCycleForSummary?.periodEndAt || null;
  const paymentSourceId = extractCustomerPaymentSourceId(meta);
  const activePlanLabel = activeSub ? formatProductTitle(activeSub?.product, activeSub?.plan) : "Sin producto activo";
  const tokenMethod = tokenMethodLabel(meta);
  const chatwootMeta = meta?.chatwoot && typeof meta.chatwoot === "object" ? (meta.chatwoot as Record<string, unknown>) : null;
  const documentLabel = String(
    meta?.identificacion ||
      meta?.identificationNumber ||
      meta?.documentNumber ||
      meta?.documento ||
      meta?.document ||
      ""
  ).trim();
  const chatwootContactId = Number(chatwootMeta?.contactId || 0);

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

  const addressMeta = meta?.address && typeof meta.address === "object" ? (meta.address as Record<string, unknown>) : null;
  const geoMeta = meta?.geo && typeof meta.geo === "object" ? (meta.geo as Record<string, unknown>) : null;
  const locationMeta = meta?.location && typeof meta.location === "object" ? (meta.location as Record<string, unknown>) : null;
  const addressParts = [
    addressMeta?.line1,
    addressMeta?.city,
    addressMeta?.dept,
    addressMeta?.code5
  ].filter(Boolean);
  const addressLabel = addressParts.join(", ");
  const directLat = Number(addressMeta?.lat ?? geoMeta?.lat ?? locationMeta?.lat);
  const directLon = Number(addressMeta?.lon ?? addressMeta?.lng ?? geoMeta?.lon ?? geoMeta?.lng ?? locationMeta?.lon ?? locationMeta?.lng);
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
  const chatwootConvos = chatwootRes?.ok && Array.isArray(chatwootRes.payload?.payload) ? chatwootRes.payload.payload : [];
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
              <div className="contact-subline">
                ID <span className="mono">{customer.id}</span>
              </div>
              <div className="contact-tags">
                {Number.isFinite(paymentSourceId) ? (
                  <>
                    <span className="pill pill-ok pill-sm">Tokenizada</span>
                    {tokenMethod ? <span className="token-method-hint">{tokenMethod}</span> : null}
                  </>
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
                {geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) ? (
                  <MapModal
                    lat={geo.lat}
                    lon={geo.lon}
                    label={addressDisplay || undefined}
                    mapLink={mapLink || undefined}
                    triggerLabel="Ubicación"
                    triggerClassName="pill pill-sm pill-muted"
                  />
                ) : (
                  <button type="button" className="pill pill-sm pill-muted" disabled>
                    Ubicación
                  </button>
                )}
              </div>
            </div>
            <div className="hero-right">
              <div className="hero-right-top">
                <div className="hero-id-block">
                  <span className="hero-id-label">NIT / ID</span>
                  <span className="hero-id-value mono">{documentLabel || "—"}</span>
                  <span className="hero-id-sub">{tenantName || customer.tenantId || "—"}</span>
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
        </div>
      </section>

      <section className="card cardPad customer-section">
        <div className="contact-section-title">Puntualidad de pagos (ciclos)</div>
        {billingCycles.length ? (
          <div className="table-scroll">
            <table className="table table-fixed">
              <colgroup>
                <col style={{ width: "12%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "24%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Ciclo</th>
                  <th>Periodo</th>
                  <th>Pago</th>
                  <th>Puntualidad</th>
                  <th>Suscripción</th>
                </tr>
              </thead>
              <tbody>
                {billingCycles.map((c: any) => {
                  const punctual =
                    c.paidOnTime == null
                      ? "—"
                      : c.paidOnTime
                        ? c.daysEarly && c.daysEarly > 0
                          ? `Temprano (${c.daysEarly}d)`
                          : "A tiempo"
                        : c.daysLate && c.daysLate > 0
                          ? `Tarde (${c.daysLate}d)`
                          : "Tarde";
                  return (
                    <tr key={c.id}>
                      <td>Ciclo {c.cycleNumber}</td>
                      <td>
                        <LocalDateTime value={c.periodStartAt} /> · <LocalDateTime value={c.periodEndAt} />
                      </td>
                      <td>{c.paidAt ? <LocalDateTime value={c.paidAt} /> : "—"}</td>
                      <td>{punctual}</td>
                      <td className="cell-truncate" title={formatProductTitle(c.subscription?.product, { name: c.subscription?.plan?.name })}>
                        {formatProductTitle(c.subscription?.product, { name: c.subscription?.plan?.name })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">Sin ciclos registrados.</div>
        )}
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
          <div className="metric-sub">{activeSub ? activePlanLabel : "Sin suscripción activa"}</div>
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section customer-dual-card">
          <div className="customer-dual">
            <div className="customer-pane">
              <div className="contact-section-title">Información del cliente</div>
              <div className="customer-info-grid">
                <div className="customer-info-card">
                  <div className="customer-info-row">
                    <span className="customer-info-label">Email</span>
                    <span className="customer-info-value truncate">{customer.email || "—"}</span>
                  </div>
                  <div className="customer-info-row">
                    <span className="customer-info-label">Teléfono</span>
                    <span className="customer-info-value">{customer.phone || "—"}</span>
                  </div>
                  <div className="customer-info-row">
                    <span className="customer-info-label">Documento</span>
                    <span className="customer-info-value mono">{documentLabel || "—"}</span>
                  </div>
                </div>
                <div className="customer-info-card">
                  <div className="customer-info-row">
                    <span className="customer-info-label">Canal</span>
                    <span className="customer-info-value">{tenantName || customer.tenantId || "—"}</span>
                  </div>
                  <div className="customer-info-row">
                    <span className="customer-info-label">Creado</span>
                    <span className="customer-info-value"><LocalDateTime value={customer.createdAt} /></span>
                  </div>
                  <div className="customer-info-row">
                    <span className="customer-info-label">Dirección</span>
                    <span className="customer-info-value">{addressDisplay || "—"}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="customer-pane">
              <div className="contact-section-title">Estado comercial</div>
              <div className="commercial-grid">
                <div className="commercial-card">
                  <span className="commercial-label">Suscripción activa</span>
                  <span className="commercial-value">{activePlanLabel}</span>
                  <span className="commercial-meta">{activeSub ? collectionLabel(String(activeSub?.plan?.collectionMode || activeSub?.plan?.metadata?.collectionMode || "")) : "—"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Estado</span>
                  <span className="commercial-value">{activeSub ? statusLabel(String(activeSub.status || "")) : "—"}</span>
                  <span className="commercial-meta">{activeSubs.length ? `${activeSubs.length} suscripción${activeSubs.length > 1 ? "es" : ""}` : "Sin suscripciones activas"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Último pago</span>
                  <span className="commercial-value">{lastPaymentAt ? <LocalDateTime value={lastPaymentAt} /> : "—"}</span>
                  <span className="commercial-meta">{lastPayment ? `Estado ${statusLabel(lastPayment.status)}` : "Sin pagos aún"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Próximo corte</span>
                  <span className="commercial-value">{nextPeriodEnd ? <LocalDateTime value={nextPeriodEnd} /> : "—"}</span>
                  <span className="commercial-meta">{activeSub ? "Ciclo activo" : "Sin ciclo"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Método</span>
                  <span className="commercial-value">{Number.isFinite(paymentSourceId) ? "Tokenizado" : "Sin token"}</span>
                  <span className="commercial-meta">{Number.isFinite(paymentSourceId) ? (tokenMethod || "Pago recurrente habilitado") : "Requiere débito automático"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Recencia</span>
                  <span className="commercial-value">{daysSinceLast == null ? "—" : `${daysSinceLast} días`}</span>
                  <span className="commercial-meta">{approvedLast30 ? `${approvedLast30} pagos 30d` : "Sin pagos 30d"}</span>
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
              <div className="chart-title">Suscripciones por estado</div>
              <div className="chart-sub">Resumen del estado actual del cliente.</div>
            </div>
            <div className="chart-range">{subscriptions.length} total</div>
          </div>
          {subscriptionStatusItems.length ? (
            <>
              <MiniBars items={subscriptionStatusItems} />
              <div className="chart-legend">
                {subscriptionStatusItems.map((item) => (
                  <span key={item.label}>
                    <i style={{ background: item.color }} />
                    {item.label} {item.value}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="muted">Sin suscripciones registradas.</div>
          )}
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
        <div className="card cardPad customer-section">
          <div className="contact-section-title">Pagos recientes</div>
          {recentPayments.length ? (
            <div className="table-scroll">
              <table className="table table-fixed">
                <colgroup>
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "34%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th>Producto</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p: any) => (
                    <tr key={p.id}>
                      <td><LocalDateTime value={p.paidAt || p.createdAt} /></td>
                      <td>{formatCopFromCents(Number(p.amountInCents || 0))}</td>
                      <td className="cell-truncate" title={String(p.status || "—")}><span className={`pill pill-sm ${statusPillClass(String(p.status || ""))}`}>{statusLabel(String(p.status || ""))}</span></td>
                      <td className="cell-truncate" title={formatProductTitle({ name: p.productName }, { name: p.planName })}>
                        {formatProductTitle({ name: p.productName }, { name: p.planName })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">Sin pagos registrados.</div>
          )}
        </div>

        <div className="card cardPad customer-section">
          <div className="contact-section-title">Actividad operativa</div>
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
        <div className="card cardPad customer-section timeline-full">
          <div className="contact-section-title">Línea de tiempo del cliente</div>
          <div className="customer-log-controls">
            <span className="muted">{formatWindowLabel(logsFrom, logsTo)}</span>
            <div className="customer-log-actions">
              <Link className="ghost btn-compact" href={`/customers/${customer.id}?logsPage=${logsPage + 1}`} data-loader="off">
                Mes anterior
              </Link>
              {logsPage <= 1 ? (
                <span className="ghost btn-compact" aria-disabled="true">
                  Más reciente
                </span>
              ) : (
                <Link className="ghost btn-compact" href={`/customers/${customer.id}?logsPage=${Math.max(1, logsPage - 1)}`} data-loader="off">
                  Más reciente
                </Link>
              )}
            </div>
          </div>
          {logs.length ? (
            <div className="timeline-scroll">
              <TimelineScroller ariaLabel="Línea de tiempo del cliente">
                <div className="customer-log-list" role="list">
                {logs.map((l: any) => (
                  (() => {
                    const customerLabel = String(customer.name || customer.email || customer.phone || "").trim();
                    const entity = cleanLogEntity(String(l.entity || ""), customerLabel);
                    const message = cleanLogMessage(String(l.message || ""), customerLabel);
                    const tooltip = `${entity}\n${new Date(l.createdAt).toLocaleString("es-CO")} · ${logLevelLabel(String(l.level || ""))}\n${l.source ? `${l.source} · ` : ""}${l.actor || "Sistema"}`;
                    return (
                      <div
                        key={l.id}
                        className="customer-log-item"
                        role="listitem"
                        tabIndex={0}
                        data-tooltip={tooltip}
                        aria-label={tooltip}
                      >
                        <div className="customer-log-title">
                          <span>{entity} {Number(l?.duplicateCount || 1) > 1 ? `x${Number(l.duplicateCount)}` : ""}</span>
                          <span className={`pill pill-sm ${logPillClass(String(l.level || ""))}`}>
                            {logLevelLabel(String(l.level || ""))}
                          </span>
                        </div>
                        <div className="customer-log-message">{message}</div>
                        <div className="customer-log-meta">
                          <span><LocalDateTime value={l.createdAt} /></span>
                          <span>{l.actor || "Sistema"}</span>
                        </div>
                      </div>
                    );
                  })()
                ))}
                </div>
              </TimelineScroller>
            </div>
          ) : (
            <div className="muted">Sin logs en este periodo.</div>
          )}
        </div>
      </section>
      {aiEnabled ? (
        <section className="grid2">
          <div className="card cardPad customer-section timeline-full">
            <div className="contact-section-title">Asistente del cliente</div>
            <AiAssistant
              from={logsFrom.toISOString()}
              to={logsTo.toISOString()}
              customerId={customer.id}
              scope="customer"
              title="Asistente del cliente"
              emptyText="Pregunta por pagos, logs y actividad del contacto. Ej: “¿Hay pagos fallidos este mes?”."
              placeholder="Pregunta sobre este cliente..."
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}
