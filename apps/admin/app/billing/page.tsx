import { activateSubscription, cancelSubscription, deleteSubscription, mergeDuplicateSubscriptions, resumeSubscription, suspendSubscription } from "../subscriptions/actions";
import { DeleteSubscriptionButton } from "./DeleteSubscriptionButton";
import { MergeDuplicateSubscriptionsButton } from "./MergeDuplicateSubscriptionsButton";
import { changeSubscriptionPlan, chargeSubscriptionNow, createCustomerFromBilling, createPlanAndSubscription, scheduleCutoff, sendCentralComPaymentLink, sendCentralComTokenizationLink, updateSubscriptionTenants } from "./actions";
import { ChargeStatusModal } from "./ChargeStatusModal";
import { BillingModals } from "./BillingModals";
import { listSubscriptions } from "../admin/_services/subscriptions";
import { listCustomers } from "../admin/_services/customers";
import { listCatalogProducts } from "../admin/_services/products";
import { listCheckoutTemplates } from "../admin/_services/checkoutTemplates";
import { listEmpresas } from "../admin/_services/companies";
import { listTenants } from "../admin/_services/tenants";
import { getAdminSettings } from "../admin/_services/settings";
import { resolveTenantId } from "../admin/_services/tenantResolver";
import { LocalDateTime } from "../ui/LocalDateTime";
import { HelpTip } from "../ui/HelpTip";
import { getCsrfToken } from "../lib/csrf";
import { ChangePlanButton, type PlanOption } from "./ChangePlanButton";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";
import { BillingTenantModalButton } from "./BillingTenantModalButton";
import { AutoCutoffInlineForm } from "./AutoCutoffInlineForm";
import { RetryDateField } from "./RetryDateField";
import { PaymentHistoryButton } from "./PaymentHistoryButton";
import { ListCsvActions } from "../ui/ListCsvActions";
import { ViewModeToggles } from "../ui/ViewModeToggles";

export const dynamic = "force-dynamic";

function fmtMoney(cents: any, currency = "COP") {
  const v = Number(cents);
  if (!Number.isFinite(v)) return "—";
  const major = Math.trunc(v / 100);
  if (currency !== "COP") return `${major} ${currency}`;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(major);
}

function fmtEvery(intervalUnit: any, intervalCount: any) {
  const unit = String(intervalUnit || "").toUpperCase();
  const count = Number(intervalCount || 1);
  const c = Number.isFinite(count) && count > 0 ? count : 1;
  if (unit === "DAY") return c === 1 ? "cada día" : `cada ${c} días`;
  if (unit === "WEEK") return c === 1 ? "cada semana" : `cada ${c} semanas`;
  if (unit === "MONTH") return c === 1 ? "cada mes" : `cada ${c} meses`;
  return `cada ${c} (personalizado)`;
}

function resolveCollectionMode(plan: any, subscriptionMeta?: any) {
  const meta = subscriptionMeta && typeof subscriptionMeta === "object" ? subscriptionMeta : {};
  const planMeta = plan?.metadata && typeof plan.metadata === "object" ? plan.metadata : {};
  const fromSubscription = (meta as any)?.collectionMode ?? (meta as any)?.billing?.collectionMode;
  if (fromSubscription != null) return String(fromSubscription || "").trim().toUpperCase() || "MANUAL_LINK";
  const fromPlan = (planMeta as any)?.collectionMode ?? plan?.collectionMode;
  return String(fromPlan || "MANUAL_LINK").trim().toUpperCase();
}

function getTipo(collectionMode: string) {
  return collectionMode === "AUTO_DEBIT" ? "Débito automático" : "Link de pago";
}

function getTipoPago(collectionMode: string) {
  if (collectionMode === "AUTO_DEBIT") return "Pago suscripción";
  if (collectionMode === "AUTO_LINK") return "Pago por link de pago";
  return "Pago por link de pago";
}
function getActivo(status: any) {
  return String(status || "") !== "CANCELED";
}

function getEstadoSimple(status: any): { label: string; class: string } {
  const s = String(status || "");
  if (s === "EXPIRED") return { label: "Vencida", class: "pill-bad" };
  if (s === "PAST_DUE") return { label: "En mora", class: "pill-bad" };
  if (s === "ACTIVE") return { label: "Activa", class: "pill-ok" };
  if (s === "SUSPENDED") return { label: "Suspendida", class: "pill-warn" };
  if (s === "CANCELED") return { label: "Cancelada", class: "pill-muted" };
  return { label: s || "—", class: "pill-muted" };
}

function getEstado(status: any): { key: "si" | "no" | "mora"; label: string; class: string } {
  const s = String(status || "");
  const base = getEstadoSimple(status);
  if (s === "ACTIVE") return { key: "si", ...base };
  if (s === "PAST_DUE") return { key: "mora", ...base };
  return { key: "no", ...base };
}

function subscriptionRank(status: any) {
  const s = String(status || "");
  if (s === "ACTIVE") return 0;
  if (s === "PAST_DUE") return 1;
  if (s === "SUSPENDED") return 2;
  if (s === "EXPIRED") return 3;
  if (s === "CANCELED") return 4;
  return 5;
}

function getPaymentStatusLabel(args: {
  status: string;
  paidAt: any;
  periodStartAt: any;
  periodEndAt: any;
}) {
  const status = String(args.status || "");
  if (status === "PAST_DUE") return "En mora";
  if (args.paidAt && args.periodStartAt && args.periodEndAt) {
    const paid = new Date(args.paidAt).getTime();
    const start = new Date(args.periodStartAt).getTime();
    const end = new Date(args.periodEndAt).getTime();
    if (Number.isFinite(paid) && Number.isFinite(start) && Number.isFinite(end) && paid >= start && paid <= end) {
      return "Pagado";
    }
  }
  return "Pendiente";
}

function getPlanLinkStatus(link: any, lastPaidAt: any) {
  if (lastPaidAt) return "Pagado";
  if (!link?.sentAt) return "Pendiente";
  const sentAt = new Date(link.sentAt).getTime();
  if (Number.isFinite(sentAt)) {
    const oneDay = 24 * 60 * 60 * 1000;
    if (Date.now() - sentAt >= oneDay) return "En mora";
  }
  return "Link enviado";
}

function normalizeImageUrl(input: unknown) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return "";
}

function readPlanPricing(meta: any) {
  if (!meta || typeof meta !== "object") return {};
  const root = meta?.pricing;
  const legacy = meta?.catalog?.pricing;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

function normalizeSku(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

function hasUsablePaymentSource(metadata: any) {
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

function formatPlanTitle(plan: any) {
  const md = (plan?.metadata as any) || {};
  const displayName = String(md?.displayName || "").trim();
  const rawName = String(plan?.name || "").trim();
  const name = displayName || rawName.replace(/^\s*\[\d+\]\s*/, "").trim() || "—";
  const sku = normalizeSku(md?.sku);
  return sku ? `${name} (SKU ${sku})` : name;
}

function buildSmartListRules({
  tipo,
  estado,
  q
}: {
  tipo: string;
  estado: string;
  q: string;
}) {
  const rules: any[] = [];

  if (tipo === "planes") {
    rules.push({ field: "hasSubscription", op: "equals", value: false });
  } else if (tipo === "suscripciones") {
    rules.push({ field: "hasSubscription", op: "equals", value: true });
  }

  if (estado === "mora") {
    rules.push({ field: "subscriptionStatus", op: "equals", value: "PAST_DUE" });
  } else if (estado === "si") {
    rules.push({ field: "subscriptionStatus", op: "equals", value: "ACTIVE" });
  } else if (estado === "no") {
    rules.push({ field: "subscriptionStatus", op: "notIn", value: ["ACTIVE", "PAST_DUE"] });
  }

  if (q.trim()) {
    rules.push({
      op: "or",
      rules: [
        { field: "name", op: "contains", value: q },
        { field: "email", op: "contains", value: q },
        { field: "metadata.identificacion", op: "contains", value: q },
        { field: "metadata.documentNumber", op: "contains", value: q }
      ]
    });
  }

  return { op: "and", rules };
}

export default async function BillingPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};

  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const checkoutUrl = typeof sp.checkoutUrl === "string" ? sp.checkoutUrl : "";
  const checkoutCustomerId = typeof sp.customerId === "string" ? sp.customerId : "";
  const tokenUrl = typeof sp.tokenUrl === "string" ? sp.tokenUrl : "";
  const chargeStatus = typeof sp.chargeStatus === "string" ? sp.chargeStatus : "";
  const chargeError = typeof sp.chargeError === "string" ? sp.chargeError : "";
  const chargeErrorDetails = typeof sp.chargeErrorDetails === "string" ? sp.chargeErrorDetails : "";
  const paymentId = typeof sp.paymentId === "string" ? sp.paymentId : "";
  const actionSubscriptionId = typeof sp.subscriptionId === "string" ? sp.subscriptionId : "";
  const cutoffScheduled = typeof sp.cutoffScheduled === "string" ? sp.cutoffScheduled : "";
  const tenantsUpdated = typeof sp.tenantsUpdated === "string" ? sp.tenantsUpdated : "";
  const central = typeof sp.central === "string" ? sp.central : "";
  const centralMode = typeof sp.centralMode === "string" ? sp.centralMode : "";
  const crear = typeof sp.crear === "string" ? sp.crear : "";
  const selectCustomerId = typeof sp.selectCustomerId === "string" ? sp.selectCustomerId : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;

  const tipo = typeof sp.tipo === "string" ? sp.tipo : "todos";
  const estado = typeof sp.estado === "string" ? sp.estado : "todos";
  const q = typeof sp.q === "string" ? sp.q : "";
  const ordenar = typeof sp.ordenar === "string" ? sp.ordenar : "vencimiento";
  const vistaRaw = typeof sp.vista === "string" ? sp.vista : "cards";
  const resolvedTenantId = tenantId ? await resolveTenantId(tenantId) : null;
  const vista = ["cards", "lista", "kanban"].includes(vistaRaw) ? vistaRaw : "cards";
  const vistaTyped = vista as "cards" | "lista" | "kanban";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
  const returnTo = `/billing${tenantId || q || tipo !== "todos" || estado !== "todos" || ordenar !== "vencimiento" || viewId || filters || (Number.isFinite(page) && page > 1)
    ? `?${new URLSearchParams({
        ...(tenantId ? { tenantId } : {}),
        ...(q ? { q } : {}),
        ...(tipo ? { tipo } : {}),
        ...(estado ? { estado } : {}),
        ...(ordenar ? { ordenar } : {}),
        ...(vista ? { vista } : {}),
        ...(viewId ? { viewId } : {}),
        ...(filters ? { filters } : {}),
        ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
      }).toString()}`
    : ""}`;
  const exportHref = `/api/list-csv?${new URLSearchParams({
    scope: "billing",
    ...(tenantId ? { tenantId } : {}),
    ...(q ? { q } : {}),
    ...(tipo ? { tipo } : {}),
    ...(estado ? { estado } : {}),
    ...(ordenar ? { ordenar } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  }).toString()}`;

  const subParams = new URLSearchParams();
  const take = vista === "kanban" ? 500 : 20;
  subParams.set("take", String(take));
  if (vista !== "kanban" && Number.isFinite(page) && page > 1) subParams.set("skip", String((Math.trunc(page) - 1) * take));
  if (q.trim()) subParams.set("q", q.trim());
  if (estado !== "todos") subParams.set("estado", estado);
  if (tipo === "suscripciones") subParams.set("collectionMode", "AUTO_DEBIT");
  if (tipo === "planes") subParams.set("collectionMode", "MANUAL_LINK");
  if (tenantId) subParams.set("tenantId", tenantId);
  const usingSmartFilters = Boolean(viewId || filters);

  if (viewId) {
    const res = await fetch(`/api/smart-views/billing/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId })
    });
    const json = await res.json().catch(() => ({}));
    const ids = Array.isArray(json?.ids) ? json.ids : [];
    if (ids.length) subParams.set("ids", ids.join(","));
  } else if (filters) {
    let parsed: any = null;
    try {
      parsed = JSON.parse(filters);
    } catch {
      parsed = null;
    }
    if (parsed) {
      const res = await fetch(`/api/smart-views/billing/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filters: parsed })
      });
      const json = await res.json().catch(() => ({}));
      const ids = Array.isArray(json?.ids) ? json.ids : [];
      if (ids.length) subParams.set("ids", ids.join(","));
    }
  }
  if (usingSmartFilters && !subParams.get("ids")) {
    subParams.set("ids", "__none__");
  }

  const [subs, customers, products, templates, empresasRes, tenantsRes, settings] = await Promise.all([
    listSubscriptions({
      tenantId: resolvedTenantId || undefined,
      take: Number(subParams.get("take") || 50),
      skip: Number(subParams.get("skip") || 0),
      q: subParams.get("q") || "",
      estado: subParams.get("estado") || "",
      collectionMode: subParams.get("collectionMode") || "",
      customerId: subParams.get("customerId") || "",
      ids: subParams.get("ids") ? String(subParams.get("ids") || "").split(",").filter(Boolean) : []
    }),
    listCustomers({ tenantId: resolvedTenantId || undefined, take: 200 }),
    listCatalogProducts({ tenantId: resolvedTenantId || undefined, take: 200 }),
    listCheckoutTemplates({ tenantId: resolvedTenantId || undefined }),
    listEmpresas({ tenantId: resolvedTenantId || undefined, take: 200 }),
    listTenants(),
    getAdminSettings()
  ]);

  const subItems = (subs.items ?? []) as any[];
  const total = Number(subs.total ?? 0);
  const customerItems = (customers.items ?? []) as any[];
  const productItems = (products.items ?? []) as any[];
  const empresas = (empresasRes?.items ?? []) as any[];
  const productById = new Map(productItems.map((p: any) => [String(p.id), p]));
  const checkoutTemplates = (templates ?? []) as any[];
  const tenants = (tenantsRes ?? []) as Array<{ id: string; name: string }>;
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));
  const autoDebitSettings = settings?.autoDebit || {};
  const checkoutConfig = settings?.checkoutConfig || {};
  const subscriptionBaseUrl = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
  const planOptions: PlanOption[] = productItems.map((p: any): PlanOption => {
    const kind = String(p?.kind || "").toUpperCase() === "SERVICE" ? "SERVICE" : "PRODUCT";
    const requiresShipping = kind === "PRODUCT" && (p?.requiresShipping === true || p?.requiresShipping == null);
    const displayName = String(p?.name || "Producto");
    const sku = String(p?.sku || "");
    const searchText = [displayName, sku, p?.id].filter(Boolean).join(" ").toLowerCase();
    return {
      id: String(p.id),
      name: displayName,
      sku,
      searchText,
      collectionMode: String(p?.collectionMode || ""),
      priceInCents: Number(p?.basePriceInCents || p?.priceInCents || 0),
      currency: String(p?.currency || "COP"),
      kind,
      requiresShipping,
      shippingInCents: Number(p?.shippingInCents || 0)
    };
  });

  const rows = subItems
    .map((s) => {
      const plan = s.plan;
      const customer = (s.customer as any) || {};
      const customerMeta = (customer?.metadata ?? {}) as any;
      const collectionMode = String(s?.collectionModeResolved || "").trim().toUpperCase() || resolveCollectionMode(plan, s?.metadata);
      const tipoTx = getTipo(collectionMode);
      const activo = getActivo(s.status);
      const estadoInfo = getEstado(s.status);
      const ident =
        customerMeta?.identificacion ||
        customerMeta?.identificationNumber ||
        customerMeta?.documentNumber ||
        customerMeta?.document ||
        "";

      const tenantIds = Array.isArray(s.tenantIds) && s.tenantIds.length ? s.tenantIds : [s.tenantId || plan?.tenantId].filter(Boolean);
      const tenantNameList = tenantIds.map((id: string) => tenantById.get(String(id))).filter(Boolean) as string[];
      const subscriptionPricing = readPlanPricing((s?.metadata as any) ?? {});
      const planPricing = readPlanPricing((plan?.metadata as any) ?? {});
      const totalInCents = Number(subscriptionPricing?.totalInCents || plan?.priceInCents || 0);
      const shippingInCents = Number(subscriptionPricing?.shippingInCents ?? planPricing?.shippingInCents ?? 0);
      const requiresShipping = String((plan?.metadata as any)?.catalog?.kind || "").toUpperCase() !== "SERVICE";
      const shippingAppliedInCents = requiresShipping ? Math.max(0, shippingInCents) : 0;
      const baseValueInCents = Math.max(0, totalInCents - shippingAppliedInCents);
      return {
        id: String(s.id),
        planId: String(plan?.id || ""),
        intervalUnit: String(plan?.intervalUnit || "MONTH"),
        intervalCount: Number(plan?.intervalCount || 1),
        tenantId: String(s.tenantId || plan?.tenantId || ""),
        tenantIds,
        customerId: String(s.customerId || ""),
        customerName: String(customer?.name || customer?.email || s.customerId || "—"),
        customerEmail: String(customer?.email || ""),
        customerTokenized: typeof s?.customerTokenized === "boolean" ? s.customerTokenized : hasUsablePaymentSource(customerMeta),
        customerMetadata: customerMeta || {},
        identificacion: String(ident || "—"),
        tipoTx,
        tipoPago: getTipoPago(collectionMode),
        activo,
        status: String(s.status || "—"),
        estadoInfo,
        planName: formatPlanTitle(plan),
        planImageUrl: normalizeImageUrl((plan?.metadata as any)?.imageUrl || (productById.get(String((plan?.metadata as any)?.catalog?.itemId || ""))?.imageUrl ?? "")),
        montoInCents: totalInCents,
        valorBaseInCents: baseValueInCents,
        totalInCents,
        moneda: String(plan?.currency || "COP"),
        cada: fmtEvery(plan?.intervalUnit, plan?.intervalCount),
        pagoAt: s.lastPayment?.paidAt || null,
        lastPaymentLink: s.lastPaymentLink || null,
        vencimientoAt: s.currentPeriodEndAt || null,
        periodoInicioAt: s.currentPeriodStartAt || null,
        periodoFinAt: s.currentPeriodEndAt || null,
        nextRetryAt: s.nextRetryJob?.runAt || (s.metadata as any)?.manualRetry?.nextRetryAt || null,
        mode: collectionMode,
        canManualCharge: typeof s?.canManualCharge === "boolean" ? s.canManualCharge : undefined,
        chargeDue: typeof s?.chargeDue === "boolean" ? s.chargeDue : undefined,
        tenantName: tenantNameList.length ? tenantNameList.join(", ") : "—",
        currentShippingInCents: shippingAppliedInCents,
        currentRequiresShipping: requiresShipping
      };
    })
    .filter((r) => {
      if (tipo === "planes" && r.tipoTx !== "Link de pago") return false;
      if (tipo === "suscripciones" && r.tipoTx !== "Débito automático") return false;
      if (estado === "si" && r.estadoInfo.key !== "si") return false;
      if (estado === "no" && r.estadoInfo.key !== "no") return false;
      if (estado === "mora" && r.estadoInfo.key !== "mora") return false;
      if (q) {
        const t = q.toLowerCase();
        const hay =
          r.customerName.toLowerCase().includes(t) ||
          r.customerEmail.toLowerCase().includes(t) ||
          String(r.identificacion || "").toLowerCase().includes(t);
        if (!hay) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (ordenar === "pago") {
        const ad = a.pagoAt ? new Date(a.pagoAt).getTime() : 0;
        const bd = b.pagoAt ? new Date(b.pagoAt).getTime() : 0;
        return bd - ad;
      }
      if (ordenar === "monto") return (b.montoInCents || 0) - (a.montoInCents || 0);
      const ad = a.vencimientoAt ? new Date(a.vencimientoAt).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.vencimientoAt ? new Date(b.vencimientoAt).getTime() : Number.POSITIVE_INFINITY;
      return ad - bd;
    });

  const duplicateCountByKey = rows.reduce((acc, row) => {
    const key = `${row.customerId}:${row.planId}`;
    if (!row.customerId || !row.planId) return acc;
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map<string, number>());
  const duplicateKeepByKey = rows.reduce((acc, row) => {
    const key = `${row.customerId}:${row.planId}`;
    if (!row.customerId || !row.planId) return acc;
    const prev = acc.get(key);
    if (!prev) {
      acc.set(key, row);
      return acc;
    }
    const prevRank = subscriptionRank(prev.status);
    const currRank = subscriptionRank(row.status);
    if (currRank < prevRank) {
      acc.set(key, row);
      return acc;
    }
    if (currRank === prevRank) {
      const prevCutoff = prev.vencimientoAt ? new Date(prev.vencimientoAt).getTime() : 0;
      const currCutoff = row.vencimientoAt ? new Date(row.vencimientoAt).getTime() : 0;
      if (currCutoff >= prevCutoff) acc.set(key, row);
    }
    return acc;
  }, new Map<string, any>());

  const paginationBase = {
    ...(tenantId ? { tenantId } : {}),
    ...(q ? { q } : {}),
    ...(tipo ? { tipo } : {}),
    ...(estado ? { estado } : {}),
    ...(ordenar ? { ordenar } : {}),
    ...(vista ? { vista } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  };

  const renderBillingCard = (r: any) => {
    const isPlan = r.mode !== "AUTO_DEBIT";
    const isAutoDebit = r.mode === "AUTO_DEBIT";
    const paymentStatus = getPaymentStatusLabel({
      status: r.status,
      paidAt: r.pagoAt,
      periodStartAt: r.periodoInicioAt,
      periodEndAt: r.periodoFinAt
    });
    const estadoSimple = getEstadoSimple(r.status);
    const rowCheckoutUrl = checkoutCustomerId && checkoutCustomerId === r.customerId ? checkoutUrl : "";
    // Leer URL de tokenización del metadata del customer
    const tokenMeta = (r.customerMetadata?.tokenizationLink as any) || {};
    const tokenMetaUrl = String(tokenMeta?.url || "").trim();
    const tokenMetaToken = String(tokenMeta?.token || "").trim();
    const tokenMetaUsedAt = tokenMeta?.usedAt ? Date.parse(String(tokenMeta.usedAt)) : NaN;
    const tokenMetaExpiresAt = tokenMeta?.expiresAt ? Date.parse(String(tokenMeta.expiresAt)) : NaN;
    const now = Date.now();
    const tokenMetaValid =
      Boolean(tokenMetaUrl) &&
      !Number.isFinite(tokenMetaUsedAt) &&
      (!Number.isFinite(tokenMetaExpiresAt) || tokenMetaExpiresAt > now);
    // Prioridad: 1) tokenUrl de query params, 2) tokenMetaUrl válido
    const rowTokenUrl = tokenUrl || (tokenMetaValid ? tokenMetaUrl : "");
    const sentForRow = central === "sent" && checkoutCustomerId && checkoutCustomerId === r.customerId;
    const sentTokenForRow = Boolean(sentForRow && rowTokenUrl);
    const sentPaymentForRow = Boolean(sentForRow && !rowTokenUrl);
    const chargedForRow = chargeStatus === "ok" && actionSubscriptionId === r.id;
    const cutoffForRow = cutoffScheduled && actionSubscriptionId === r.id;
    const tenantsUpdatedForRow = tenantsUpdated && actionSubscriptionId === r.id;
    const cutoffDueAt = r.vencimientoAt ? new Date(r.vencimientoAt) : null;
    const isCutoffOverdue = Boolean(cutoffDueAt && !Number.isNaN(cutoffDueAt.getTime()) && cutoffDueAt.getTime() <= Date.now());
    const manualChargeEnabled = Boolean(autoDebitSettings?.allowManualCharge ?? true);
    const chargeDue = typeof r.chargeDue === "boolean" ? r.chargeDue : r.status === "PAST_DUE" || r.status === "EXPIRED" || isCutoffOverdue;
    const isCanceled = r.status === "CANCELED";
    const isSuspended = r.status === "SUSPENDED";
    const isInactive = isCanceled || isSuspended;
    // Botón de cobrar: siempre visible para débito automático cuando hay pago vencido
    const showChargeButton =
      typeof r.canManualCharge === "boolean"
        ? r.canManualCharge
        : manualChargeEnabled && isAutoDebit && chargeDue && !isInactive && r.customerTokenized;
    // Botón de enviar link de pago: visible para link de pago manual
    const showPaymentLinkButton = !isAutoDebit && !isInactive;
    // Botón de tokenización: siempre visible para débito automático (independiente del link de pago)
    const needsTokenization = isAutoDebit && !r.customerTokenized;
    const showTokenizationLink = needsTokenization && !isInactive;
    const duplicateKey = `${r.customerId}:${r.planId}`;
    const duplicateCount = duplicateCountByKey.get(duplicateKey) || 1;
    const keepRowId = duplicateKeepByKey.get(duplicateKey)?.id || r.id;
    const productInitials = String(r.planName || "Producto")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase())
      .join("") || "PR";
    
    return (
      <div className="billing-card">
        <div className="billing-header">
          <div className="billing-badges billing-badges-header">
            <div className="billing-header-meta-grid">
              <div className="billing-header-meta-item">
                <span className="billing-header-label">
                  Canal de ventas
                  <HelpTip text="Define el canal o tenant con el que se reporta y factura esta suscripción." />
                </span>
                <BillingTenantModalButton
                  triggerId={`tenant-modal-open-${r.id}`}
                  triggerLabel={r.tenantName || "Sin canal"}
                  triggerClassName="pill pill-sm pill-muted"
                  subscriptionId={r.id}
                  scopeTenantId={r.tenantId || ""}
                  tenantIds={Array.isArray(r.tenantIds) ? r.tenantIds.map(String) : []}
                  tenants={tenants}
                  csrfToken={csrfToken}
                  returnTo={returnTo}
                  action={updateSubscriptionTenants}
                />
              </div>

              <div className="billing-header-meta-item billing-header-status-strip">
                <span className="billing-header-label">
                  Estado
                  <HelpTip text="Resume el estado de la suscripción y si la tarjeta está tokenizada." />
                </span>
                <div className="billing-status-line" role="group" aria-label="Estado">
                  <span className={`pill pill-sm ${estadoSimple.class}`} title={`Estado: ${estadoSimple.label}`}>
                    {estadoSimple.label}
                  </span>
                  {r.customerTokenized ? (
                    <span className="pill pill-sm pill-ok" title="Tarjeta tokenizada">
                      Tarjeta guardada
                    </span>
                  ) : (
                    <span className="pill pill-sm pill-warn" title="Sin tarjeta tokenizada">
                      Sin tarjeta
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="billing-header-right">
            <div className="billing-header-actions">
              {r.planId ? (
                <ChangePlanButton
                  subscriptionId={r.id}
                  currentPlanId={r.planId}
                  currentEndAt={r.vencimientoAt}
                  currentShippingInCents={r.currentShippingInCents}
                  currentRequiresShipping={r.currentRequiresShipping}
                  currentPlanName={r.planName}
                  currentPlanCurrency={r.moneda}
                  plans={planOptions}
                  csrfToken={csrfToken}
                  returnTo={returnTo}
                  tenantId={r.tenantId}
                  action={changeSubscriptionPlan}
                  iconOnly
                />
              ) : null}
              <PaymentHistoryButton subscriptionId={r.id} tenantId={r.tenantId} />
              <DeleteSubscriptionButton action={deleteSubscription} csrfToken={csrfToken} subscriptionId={r.id} tenantId={r.tenantId} returnTo={returnTo} />
            </div>
          </div>
        </div>

        <div className="billing-grid-info billing-grid-subscription">
          <div className="billing-body-main">
            {/* Datos personales */}
            <div className="billing-body-section">
              <div className="billing-section-title">Contacto</div>
              <div className="billing-title">
                <div className="billing-name billing-value">{r.customerName}</div>
                <div className="billing-sub">
                  {r.customerEmail || "—"} {r.identificacion && r.identificacion !== "—" ? `· ${r.identificacion}` : ""}
                </div>
              </div>
            </div>
            
            {/* Producto */}
            <div className="billing-body-section">
              <div className="billing-section-title">Producto</div>
              <div className="billing-product-row">
                <div className="product-thumb billing-product-thumb">
                  {r.planImageUrl ? (
                    <img
                      src={r.planImageUrl}
                      alt={r.planName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span className="billing-product-fallback">{productInitials}</span>
                  )}
                </div>
                <div className="billing-product-meta">
                  <strong className="billing-value">{r.planName}</strong>
                </div>
              </div>
            </div>
            
            {/* Fechas - EN LÍNEA HORIZONTAL */}
            <div className="billing-body-section billing-section-dates">
              <div className="billing-section-title">
                Próximo cobro
                <HelpTip text="Corte define el final del ciclo. Próximo indica el siguiente intento de cobro." />
              </div>
              <div className="billing-date-row">
                <div className="date-item">
                  <span className="date-label">Corte:</span>
                  <AutoCutoffInlineForm
                    subscriptionId={r.id}
                    csrfToken={csrfToken}
                    returnTo={returnTo}
                    tenantId={r.tenantId}
                    currentEndAt={r.vencimientoAt}
                    action={scheduleCutoff}
                  />
                </div>
                <div className="date-item">
                  <span className="date-label">Próximo:</span>
                  <RetryDateField
                    subscriptionId={r.id}
                    currentPeriodEndAt={r.vencimientoAt}
                    nextRetryAt={r.nextRetryAt}
                    csrfToken={csrfToken}
                    returnTo={returnTo}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="billing-body-side">
            <div className="billing-cost-panel">
              <span className="billing-cost-title">
                Totales
                <HelpTip text="Incluye base + flete según configuración del plan y del ciclo actual." />
              </span>
              <div className="billing-cost-box">
                <div className="billing-cost-summary">
                  <div className="billing-cost-total">{fmtMoney(r.totalInCents ?? r.montoInCents, r.moneda)}</div>
                  <div className="billing-cost-period">{r.cada}</div>
                </div>
                <div className="billing-cost-inline billing-cost-inline-nowrap">
                  <span className="billing-cost-chip">Base {fmtMoney(r.valorBaseInCents ?? r.montoInCents, r.moneda)}</span>
                  {r.currentShippingInCents > 0 ? (
                    <span className="billing-cost-chip">Flete {fmtMoney(r.currentShippingInCents, r.moneda)}</span>
                  ) : (
                    <span className="billing-cost-chip">Flete Gratis</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="billing-actions">
          <div className="billing-actions-left">
            {duplicateCount > 1 && keepRowId === r.id ? (
              <MergeDuplicateSubscriptionsButton
                action={mergeDuplicateSubscriptions}
                csrfToken={csrfToken}
                customerId={r.customerId}
                planId={r.planId}
                keepSubscriptionId={keepRowId}
                tenantId={r.tenantId}
                returnTo={returnTo}
                duplicatesCount={duplicateCount}
              />
            ) : null}
            {showChargeButton ? (
              <form action={chargeSubscriptionNow}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="subscriptionId" value={r.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                <button
                  className="ghost btn-compact btn-blue btn-pay"
                  type="submit"
                  title={
                    isCutoffOverdue
                      ? "Cobrar ahora (fecha de corte vencida)"
                      : "Cobrar ahora"
                  }
                >
                  Cobrar
                </button>
              </form>
            ) : null}
          </div>
          <div className="billing-actions-right">
            {showPaymentLinkButton ? (
              <form action={sendCentralComPaymentLink}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="subscriptionId" value={r.id} />
                <input type="hidden" name="customerId" value={r.customerId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                <button className="ghost btn-compact btn-send" type="submit" title="Enviar link de pago manual">
                  Enviar link de pago
                </button>
              </form>
            ) : null}
            {showTokenizationLink ? (
              rowTokenUrl ? (
                <a
                  className="ghost btn-compact btn-send btn-highlight"
                  href={rowTokenUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Abrir link de tokenización"
                >
                  Abrir link
                </a>
              ) : (
                <form action={sendCentralComTokenizationLink}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="customerId" value={r.customerId} />
                  <input type="hidden" name="planId" value={r.planId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                  <button
                    className="ghost btn-compact btn-send btn-highlight"
                    type="submit"
                    title="Enviar link para guardar tarjeta"
                  >
                    Enviar link
                  </button>
                </form>
              )
            ) : null}
            {r.status === "SUSPENDED" ? (
              <form action={resumeSubscription}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="subscriptionId" value={r.id} />
                {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                <button className="ghost btn-compact btn-green" type="submit" title="Reanudar suscripción">
                  Reanudar
                </button>
              </form>
            ) : r.status === "CANCELED" ? (
              <form action={activateSubscription}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="subscriptionId" value={r.id} />
                {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                <button className="ghost btn-compact btn-green" type="submit" title="Activar suscripción">
                  Activar
                </button>
              </form>
            ) : (
              <>
                <form action={cancelSubscription}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="subscriptionId" value={r.id} />
                  {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                  <button className="ghost btn-compact btn-red" type="submit" title="Cancelar suscripción">
                    Cancelar
                  </button>
                </form>
                <form action={suspendSubscription}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="subscriptionId" value={r.id} />
                  {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                  <button className="ghost btn-compact btn-amber" type="submit" title="Suspender suscripción">
                    Suspender
                  </button>
                </form>
              </>
            )}
          </div>
          {(sentForRow || chargedForRow || cutoffForRow) ? (
            <div className="field-hint billing-action-feedback">
              {sentTokenForRow ? <span>Link de tarjeta enviado.</span> : null}
              {sentPaymentForRow ? <span>Link de pago enviado.</span> : null}
              {chargedForRow ? <span>Cobro manual enviado.</span> : null}
              {cutoffForRow ? <span>Fecha de corte actualizada.</span> : null}
            </div>
          ) : null}
          {tenantsUpdatedForRow ? <div className="field-hint">Canales actualizados.</div> : null}
        </div>
      </div>
    );
  };

  return (
    <main className="page pageWide billing-page">
      {chargeStatus ? (
        <ChargeStatusModal
          initialStatus={chargeStatus === "processing" ? "processing" : chargeStatus === "ok" ? "ok" : "fail"}
          paymentId={paymentId}
          chargeError={chargeError}
          chargeErrorDetails={chargeErrorDetails}
          returnTo={returnTo}
          subscriptionId={actionSubscriptionId}
          tenantId={tenantId}
          csrfToken={csrfToken}
          retryAction={chargeSubscriptionNow}
        />
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="filtersRow">
            <div className="filtersLeft">
              <div className="filtersPanel">
                <div className="contacts-search-row">
                  <form action="/billing" method="GET" className="filtersForm filtersSearch">
                    {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                    {tipo ? <input type="hidden" name="tipo" value={tipo} /> : null}
                    {estado ? <input type="hidden" name="estado" value={estado} /> : null}
                    {ordenar ? <input type="hidden" name="ordenar" value={ordenar} /> : null}
                    {vista ? <input type="hidden" name="vista" value={vista} /> : null}
                    {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
                    {filters ? <input type="hidden" name="filters" value={filters} /> : null}
                    <input
                      className="input"
                      type="search"
                      name="q"
                      defaultValue={q}
                      placeholder="Buscar por contacto, email o identificación..."
                      aria-label="Buscar suscripciones"
                    />
                    <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
                  </form>
                  <div className="module-search-right">
                    <SmartViewsBar
                      scope="billing"
                      initialViewId={viewId}
                      initialFilters={filters}
                      baseParams={{
                        ...(tenantId ? { tenantId } : {}),
                        ...(q ? { q } : {}),
                        ...(tipo ? { tipo } : {}),
                        ...(estado ? { estado } : {}),
                        ...(ordenar ? { ordenar } : {})
                      }}
                      compactInline
                    />
                    <ListCsvActions exportHref={exportHref} tenantId={tenantId} defaultEntity="customers" />
                  </div>
                </div>
                <div className="view-mode-row" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <span className="field-hint" style={{ margin: 0 }}>Vista:</span>
                  <ViewModeToggles
                    currentMode={vistaTyped}
                    baseParams={{
                      ...(tenantId ? { tenantId } : {}),
                      ...(q ? { q } : {}),
                      ...(tipo ? { tipo } : {}),
                      ...(estado ? { estado } : {}),
                      ...(ordenar ? { ordenar } : {})
                    }}
                    showKanban
                  />
                </div>
                <div className="page-actions">
                  <BillingModals
                    customers={customerItems}
                    empresas={empresas}
                    catalogItems={productItems}
                    checkoutTemplates={checkoutTemplates}
                    csrfToken={csrfToken}
                    tenantId={tenantId}
                    tenants={tenants}
                    returnTo={returnTo}
                    defaultOpen={Boolean(crear) || Boolean(selectCustomerId)}
                    defaultSelectedCustomerId={selectCustomerId}
                    createCustomer={createCustomerFromBilling}
                    createPlanAndSubscription={createPlanAndSubscription}
                  />
                  <div className="page-actions-summary">{rows.length} resultados</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          {vista === "cards" ? (
            <div className="billing-grid">
              {rows.map((r) => (
                <div key={r.id}>{renderBillingCard(r)}</div>
              ))}
              {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
            </div>
          ) : vista === "lista" ? (
            <div className="billing-list">
              <div className="billing-list-header">
                <span>Datos personales</span>
                <span>Producto</span>
                <span>Fecha de corte</span>
                <span>Estado</span>
                <span>Acciones</span>
              </div>
              {rows.map((r) => {
                const paymentStatus = getPaymentStatusLabel({
                  status: r.status,
                  paidAt: r.pagoAt,
                  periodStartAt: r.periodoInicioAt,
                  periodEndAt: r.periodoFinAt
                });
                const estadoSimple = getEstadoSimple(r.status);
                const contactHref = `/customers?${new URLSearchParams({
                  tx: r.customerId,
                  ...(r.tenantId ? { tenantId: r.tenantId } : {})
                }).toString()}`;
                const productHref = `/products?${new URLSearchParams({
                  q: r.planName || "",
                  ...(r.tenantId ? { tenantId: r.tenantId } : {})
                }).toString()}`;
                return (
                  <div className="billing-list-row" key={`list-${r.id}`}>
                    <div className="billing-list-cell billing-list-person">
                      <a className="billing-list-name" href={contactHref}>{r.customerName}</a>
                      <div className="billing-list-sub">{r.customerEmail || "—"} · {r.identificacion || "—"}</div>
                    </div>
                    <div className="billing-list-cell billing-list-product">
                      <a className="billing-list-link" href={productHref}>{r.planName || "—"}</a>
                      <div className="billing-list-sub">{r.tipoTx || "—"} · Suscripción {estadoSimple.label}</div>
                    </div>
                    <div className="billing-list-cell billing-list-cutoff">
                      <LocalDateTime value={r.vencimientoAt} variant="short" />
                    </div>
                    <div className="billing-list-cell billing-list-status">
                      <span
                        className={`pill pill-sm ${paymentStatus === "Pagado" ? "pill-ok" : paymentStatus === "En mora" ? "pill-warn" : "pill-muted"}`}
                        title={`Pago: ${paymentStatus} · Suscripción: ${estadoSimple.label}`}
                      >
                        {paymentStatus}
                      </span>
                    </div>
                    <div className="billing-list-cell billing-list-more">
                      <details className="inline-detail billing-pop">
                        <summary className="ghost btn-compact btn-icon-only btn-open" aria-label="Ver más" title="Ver más" />
                        <div className="inline-detail-body billing-pop-body">
                          {renderBillingCard(r)}
                        </div>
                      </details>
                    </div>
                  </div>
                );
              })}
              {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
            </div>
          ) : (
            (() => {
              const columns = ["Pagado", "Pendiente", "En mora"];
              const grouped = new Map<string, any[]>();
              for (const c of columns) grouped.set(c, []);
              for (const r of rows) {
                const paymentStatus = getPaymentStatusLabel({
                  status: r.status,
                  paidAt: r.pagoAt,
                  periodStartAt: r.periodoInicioAt,
                  periodEndAt: r.periodoFinAt
                });
                const key = paymentStatus === "Pagado" ? "Pagado" : paymentStatus === "En mora" ? "En mora" : "Pendiente";
                grouped.get(key)?.push(r);
              }
              return (
                <div className="billing-kanban">
                  {columns.map((col, idx) => (
                    <div className="billing-kanban-column" data-idx={idx + 1} key={`kanban-${col}`}>
                      <div className="billing-kanban-title">
                        <span>{col}</span>
                        <span className="pill pill-sm pill-muted">{grouped.get(col)?.length || 0}</span>
                      </div>
                      <div className="billing-kanban-list">
                        {(grouped.get(col) || []).map((r) => (
                          <details className="inline-detail billing-kanban-card" key={`kanban-item-${r.id}`}>
                            <summary className="billing-kanban-summary" title={`Suscripción: ${getEstadoSimple(r.status).label}`}>
                              <div className="billing-kanban-name">{r.customerName}</div>
                              <div className="billing-kanban-sub">{r.planName || "—"}</div>
                              <div className="billing-kanban-meta">
                                <span>{fmtMoney(r.totalInCents ?? r.montoInCents, r.moneda)}</span>
                                <span>·</span>
                                <LocalDateTime value={r.vencimientoAt} variant="short" />
                              </div>
                              <div className="billing-kanban-badges">
                                <span className={`pill pill-sm ${getEstadoSimple(r.status).class}`}>
                                  {getEstadoSimple(r.status).label}
                                </span>
                              </div>
                            </summary>
                            <div className="inline-detail-body billing-pop-body">
                              {renderBillingCard(r)}
                            </div>
                          </details>
                        ))}
                        {(grouped.get(col) || []).length === 0 ? <div className="billing-kanban-empty">Sin registros</div> : null}
                      </div>
                    </div>
                  ))}
                  {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
                </div>
              );
            })()
          )}

          {vista === "kanban" ? null : (() => {
            const currentPage = Math.max(1, Number(page) || 1);
            const hasNext = total > 0 ? currentPage < Math.max(1, Math.ceil(total / take)) : rows.length >= take;
            const totalPages = total > 0 ? Math.max(1, Math.ceil(total / take)) : currentPage + (hasNext ? 1 : 0);
            const desktopWindow = 10;
            let start = Math.max(1, currentPage - Math.floor(desktopWindow / 2));
            let end = start + (desktopWindow - 1);
            if (end > totalPages) {
              end = totalPages;
              start = Math.max(1, end - (desktopWindow - 1));
            }
            const pages = [];
            for (let i = start; i <= end; i += 1) pages.push(i);
            const mobileWindow = 5;
            let mobileStart = Math.max(1, currentPage - 2);
            let mobileEnd = mobileStart + (mobileWindow - 1);
            if (mobileEnd > totalPages) {
              mobileEnd = totalPages;
              mobileStart = Math.max(1, mobileEnd - (mobileWindow - 1));
            }
            return (
              <div className="pagination pagination-indicator">
                <a
                  className="page-link page-nav"
                  href={`/billing?${new URLSearchParams({
                    ...paginationBase,
                    page: String(Math.max(1, currentPage - 1))
                  })}`}
                  aria-disabled={currentPage <= 1}
                >
                  Anterior
                </a>
                <div className="pagination-pages">
                  {pages.map((p) => {
                    const isDesktopOnly = p < mobileStart || p > mobileEnd;
                    return (
                      <a
                        key={`billing-page-${p}`}
                        className={`page-link ${p === currentPage ? "is-active" : ""} ${isDesktopOnly ? "page-desktop-only" : ""}`}
                        href={`/billing?${new URLSearchParams({ ...paginationBase, page: String(p) })}`}
                        aria-current={p === currentPage ? "page" : undefined}
                      >
                        {p}
                      </a>
                    );
                  })}
                </div>
                <a
                  className="page-link page-nav"
                  href={`/billing?${new URLSearchParams({
                    ...paginationBase,
                    page: String(currentPage + 1)
                  })}`}
                  aria-disabled={!hasNext}
                >
                  Siguiente
                </a>
              </div>
            );
          })()}
        </div>
      </section>
    </main>
  );
}
