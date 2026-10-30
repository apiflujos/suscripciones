import { isNoiseNotification, normalizeSystemText } from "../../lib/logPresentation";
import { extractCustomerPaymentSourceId, readCustomerMetadata } from "@suscripciones/core/lib/customerMetadata";

/** Formato y gráficas pequeñas de la ficha del contacto (sacados de page.tsx). */

export function formatCopFromCents(cents: number) {
  const pesos = Math.trunc(Number(cents || 0) / 100);
  if (!Number.isFinite(pesos)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

export function statusLabel(status: string) {
  if (!status) return "—";
  if (status === "ACTIVE") return "Activa";
  if (status === "PAST_DUE") return "En mora";
  if (status === "PENDING") return "Pendiente";
  if (status === "APPROVED") return "Aprobado";
  if (status === "DECLINED" || status === "ERROR" || status === "VOIDED") return "Fallido";
  return status;
}

export function statusPillClass(status: string) {
  if (status === "ACTIVE" || status === "APPROVED") return "pill-ok";
  if (status === "PAST_DUE" || status === "DECLINED" || status === "ERROR" || status === "VOIDED") return "pill-bad";
  if (status === "PENDING") return "pill-muted";
  return "pill-muted";
}

export function logLevelLabel(level: string) {
  const upper = String(level || "").toUpperCase();
  if (!upper) return "—";
  if (upper === "ERROR") return "Error";
  if (upper === "WARN" || upper === "WARNING") return "Alerta";
  if (upper === "INFO") return "Info";
  return upper;
}

export function logPillClass(level: string) {
  const upper = String(level || "").toUpperCase();
  if (upper === "ERROR") return "pill-bad";
  if (upper === "WARN" || upper === "WARNING") return "pill-warn";
  if (upper === "INFO") return "pill-muted";
  return "pill-muted";
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanLogEntity(raw: string, customerLabel: string) {
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

export function cleanLogMessage(raw: string, customerLabel: string) {
  let out = normalizeSystemText(raw);
  if (!out) return "—";
  if (customerLabel) {
    const safe = escapeRegex(customerLabel);
    out = out.replace(new RegExp(`\\b${safe}\\b`, "ig"), "");
  }
  out = out.replace(/\s{2,}/g, " ").trim();
  return out || "—";
}

export function isRelevantCustomerLog(log: any) {
  const source = String(log?.source || "").trim();
  const title = normalizeSystemText(log?.entity || "");
  const message = normalizeSystemText(log?.message || "");
  if (isNoiseNotification({ source, title, message })) return false;
  return true;
}

export function compactCustomerLogs(items: any[]) {
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

export function collectionLabel(mode: string) {
  if (mode === "AUTO_DEBIT") return "Débito automático";
  if (mode === "AUTO_LINK") return "Link de pago (auto)";
  return "Link de pago";
}

export function normalizeSku(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

export function formatPlanTitle(plan: any) {
  const md = (plan?.metadata as any) || {};
  const displayName = String(md?.displayName || "").trim();
  const rawName = String(plan?.name || "").trim();
  const cleanName = rawName.replace(/^\s*\[\d+\]\s*/, "").trim();
  const name = displayName || cleanName || "—";
  const sku = normalizeSku(md?.sku);
  return sku ? `SKU ${sku} · ${name}` : name;
}

export function formatProductTitle(product: any, fallbackPlan?: any) {
  const displayName = String(product?.displayName || product?.name || "").trim();
  if (displayName) return displayName;
  return formatPlanTitle(fallbackPlan);
}

export function tokenMethodLabel(meta: unknown) {
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

export function epochToIso(value: any) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const ms = num > 1_000_000_000_000 ? num : num * 1000;
  return new Date(ms).toISOString();
}

export function MiniLine({ values, formatValue }: { values: number[]; formatValue?: (value: number) => string }) {
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

export function MiniBars({ items }: { items: Array<{ label: string; value: number; color: string }> }) {
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

export function MiniDonut({
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

