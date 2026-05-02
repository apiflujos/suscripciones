import { getCivilDateAnchorUtc, getCivilDateKey } from "@suscripciones/core/lib/dates";
import type {
  BadgeInfo,
  CardCollectionStateArgs,
  CollectionStatusArgs,
  EstadoInfo,
  EstadoSimpleInfo
} from "./billingTypes";

export function fmtMoney(cents: any, currency = "COP") {
  const v = Number(cents);
  if (!Number.isFinite(v)) return "—";
  const major = Math.trunc(v / 100);
  if (currency !== "COP") return `${major} ${currency}`;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(major);
}

export function fmtEvery(intervalUnit: any, intervalCount: any) {
  const unit = String(intervalUnit || "").toUpperCase();
  const count = Number(intervalCount || 1);
  const c = Number.isFinite(count) && count > 0 ? count : 1;
  if (unit === "DAY") return c === 1 ? "cada día" : `cada ${c} días`;
  if (unit === "WEEK") return c === 1 ? "cada semana" : `cada ${c} semanas`;
  if (unit === "MONTH") return c === 1 ? "cada mes" : `cada ${c} meses`;
  return `cada ${c} (personalizado)`;
}

export function getTipo(collectionMode: string) {
  return collectionMode === "AUTO_DEBIT" ? "Débito automático" : "Link de pago";
}

export function getTipoPago(collectionMode: string) {
  if (collectionMode === "AUTO_DEBIT") return "Pago suscripción";
  if (collectionMode === "AUTO_LINK") return "Pago por link de pago";
  return "Pago por link de pago";
}

export function getActivo(status: any) {
  return String(status || "") !== "CANCELED";
}

export function getEstadoSimple(status: any): EstadoSimpleInfo {
  const s = String(status || "");
  if (s === "ACTIVE" || s === "PAST_DUE") return { label: "Activa", class: "pill-ok" };
  if (s === "SUSPENDED") return { label: "Suspendida", class: "pill-warn" };
  if (s === "CANCELED" || s === "EXPIRED") return { label: "Cancelada", class: "pill-muted" };
  return { label: s || "—", class: "pill-muted" };
}

export function getEstado(status: any): EstadoInfo {
  const s = String(status || "");
  const base = getEstadoSimple(status);
  if (s === "ACTIVE" || s === "PAST_DUE") return { key: "si", ...base };
  return { key: "no", ...base };
}

export function subscriptionRank(status: any) {
  const s = String(status || "");
  if (s === "ACTIVE") return 0;
  if (s === "PAST_DUE") return 1;
  if (s === "SUSPENDED") return 2;
  if (s === "EXPIRED") return 3;
  if (s === "CANCELED") return 4;
  return 5;
}

export function getCollectionStatusLabel(args: CollectionStatusArgs) {
  if (args.collectionCyclePaid) return "Al día";
  const status = String(args.status || "").toUpperCase();
  const graceDays = Number.isFinite(Number(args.graceDays)) ? Math.max(0, Math.trunc(Number(args.graceDays))) : 5;
  const dueAt = args.dueAt ? new Date(args.dueAt as any) : null;
  const nowDate = args.nowDate instanceof Date ? args.nowDate : getCivilDateAnchorUtc(new Date());
  if (!dueAt || Number.isNaN(dueAt.getTime())) return status === "PAST_DUE" || status === "EXPIRED" ? "En mora" : "Al día";
  const dueKey = getCivilDateKey(dueAt);
  const nowKey = getCivilDateKey(nowDate);
  if (nowKey <= dueKey) return "Al día";
  const dueAnchor = getCivilDateAnchorUtc(dueAt);
  const nowAnchor = getCivilDateAnchorUtc(nowDate);
  const daysLate = Math.ceil((nowAnchor.getTime() - dueAnchor.getTime()) / (24 * 60 * 60 * 1000));
  if (daysLate <= graceDays) return "En gracia";
  return "En mora";
}

export function getCardCollectionState(args: CardCollectionStateArgs) {
  const collectionStatus = getCollectionStatusLabel(args);
  if (collectionStatus === "En mora") return { label: "En mora", class: "pill-bad" };
  if (collectionStatus === "En gracia") return { label: "En gracia", class: "pill-warn" };
  return { label: "Al día", class: "pill-ok" };
}

export function formatLongCivilDate(value?: string | Date | null) {
  if (!value) return "—";
  const raw = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [year, month, day] = raw.split("-").map((part) => Number(part));
  if (!year || !month || !day) return "—";
  const safe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(safe);
}

export function getPlanLinkStatus(link: any, lastPaidAt: any) {
  if (lastPaidAt) return "Pagado";
  if (!link?.sentAt) return "Pendiente";
  return "Link enviado";
}

export function buildBillingStatusCards(r: any) {
  const badges: BadgeInfo[] = [];
  const mainState = getCardCollectionState({
    status: r.status,
    dueAt: r.vencimientoAt,
    graceDays: r.graceDays,
    collectionCyclePaid: r.collectionCyclePaid
  });
  const subscriptionState = getEstadoSimple(r.status);
  badges.push({ heading: "Suscripción", value: subscriptionState.label, className: subscriptionState.class });
  badges.push({ heading: "Pago", value: mainState.label, className: mainState.class });

  if (r.tipoTx) {
    badges.push({
      heading: "Método",
      value: r.tipoTx,
      className: "pill-muted"
    });
  }

  const linkStatus = getPlanLinkStatus(r.lastPaymentLink, r.pagoAt);
  if (String(r.mode || "") !== "AUTO_DEBIT" && linkStatus === "Link enviado") {
    const sentAt = r.lastPaymentLink?.sentAt ? formatLongCivilDate(r.lastPaymentLink.sentAt) : "";
    badges.push({
      heading: "Cobro",
      value: "Link enviado",
      className: "pill-muted",
      title: sentAt ? `Link enviado el ${sentAt}` : "Link de pago enviado"
    });
  }

  if (String(r.mode || "") === "AUTO_DEBIT") {
    badges.push({
      heading: "Tarjeta",
      value: r.customerTokenized ? "Guardada" : "Sin tarjeta",
      className: r.customerTokenized ? "pill-ok" : "pill-warn",
      title: r.customerTokenized ? "Tarjeta tokenizada disponible" : "Falta tarjeta tokenizada"
    });
  }

  return badges;
}

export function normalizeImageUrl(input: unknown) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return "";
}

export function readPlanPricing(meta: any) {
  if (!meta || typeof meta !== "object") return {};
  const root = meta?.pricing;
  const legacy = meta?.catalog?.pricing;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

export function normalizeSku(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

export function hasUsablePaymentSource(metadata: any) {
  const candidates = [
    metadata?.wompi?.paymentSourceId,
    metadata?.wompi?.payment_source_id,
    metadata?.paymentSourceId,
    metadata?.payment_source_id
  ];
  return candidates.some((value) => {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") {
      const normalized = value.trim();
      if (!normalized) return false;
      if (/^(null|undefined)$/i.test(normalized)) return false;
      if (/^\d+$/.test(normalized)) return true;
      if (/^src[_-]/i.test(normalized)) return true;
      return normalized.length >= 6;
    }
    return false;
  });
}

export function formatPlanTitle(plan: any) {
  const md = (plan?.metadata as any) || {};
  const displayName = String(md?.displayName || "").trim();
  const rawName = String(plan?.name || "").trim();
  const name = displayName || rawName.replace(/^\s*\[\d+\]\s*/, "").trim() || "—";
  const sku = normalizeSku(md?.sku);
  return sku ? `${name} (SKU ${sku})` : name;
}

export function splitPlanDisplay(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return { name: "—", sku: "" };
  const skuMatch = raw.match(/^(.*?)(?:\s*\(SKU\s*([^)]+)\))$/i);
  if (skuMatch) {
    const name = String(skuMatch[1] || "").trim().replace(/^\[\d+\]\s*/, "") || raw;
    return { name, sku: String(skuMatch[2] || "").trim() };
  }
  const bracketMatch = raw.match(/^\[(\d+)\]\s*(.+)$/);
  if (bracketMatch) {
    return {
      name: String(bracketMatch[2] || "").trim() || raw,
      sku: String(bracketMatch[1] || "").trim()
    };
  }
  return { name: raw, sku: "" };
}

export function splitProductDisplay(value: unknown) {
  return splitPlanDisplay(value);
}

export function extractTemplateProductId(entry: any) {
  if (!entry) return "";
  if (typeof entry === "string") return String(entry).trim();
  if (typeof entry === "object") return String(entry?.id || "").trim();
  return "";
}

export function templateMatchesProduct(template: any, productId: string) {
  const list = Array.isArray(template?.productIds) ? template.productIds : [];
  return list.some((entry: any) => String(extractTemplateProductId(entry)) === String(productId));
}

export function templateMatchesTenant(template: any, tenantId?: string | null) {
  const resolvedTenantId = String(tenantId || "").trim();
  if (!resolvedTenantId) return true;
  const templateTenantId = String(template?.tenantId || "").trim();
  return !templateTenantId || templateTenantId === resolvedTenantId;
}
