import { activateSubscription, cancelSubscription, deleteSubscription, resumeSubscription, suspendSubscription } from "../subscriptions/actions";
import { DeleteSubscriptionButton } from "./DeleteSubscriptionButton";
import { changeSubscriptionPlan, chargeSubscriptionNow, createCustomerFromBilling, createPlanAndSubscription, scheduleCutoff, sendCentralComPaymentLink, sendCentralComTokenizationLink, updateSubscriptionTenants } from "./actions";
import { ChargeStatusModal } from "./ChargeStatusModal";
import { NewBillingAssignmentForm } from "./NewBillingAssignmentForm";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { normalizeErrorParam } from "../lib/errorParam";
import { LocalDateTime } from "../ui/LocalDateTime";
import { HelpTip } from "../ui/HelpTip";
import { CopyButton } from "../ui/CopyButton";
import { getCsrfToken } from "../lib/csrf";
import { ChangePlanButton, type PlanOption } from "./ChangePlanButton";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";
import { BillingTenantModalButton } from "./BillingTenantModalButton";
import { AutoCutoffInlineForm } from "./AutoCutoffInlineForm";
import { ListCsvActions } from "../ui/ListCsvActions";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchAdmin(path: string) {
  return fetchAdminCached(path, { ttlMs: 1500 });
}

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

function getTipo(plan: any) {
  const mode = String(plan?.collectionMode || plan?.metadata?.collectionMode || "MANUAL_LINK");
  return mode === "AUTO_DEBIT" ? "Débito automático" : "Link de pago";
}

function getTipoPago(plan: any) {
  const mode = String(plan?.collectionMode || plan?.metadata?.collectionMode || "");
  if (mode === "AUTO_DEBIT") return "Pago suscripción";
  if (mode === "AUTO_LINK") return "Pago por link de pago";
  return "Pago por link de pago";
}
function getActivo(status: any) {
  return String(status || "") !== "CANCELED";
}

function getEstado(status: any) {
  const s = String(status || "");
  if (s === "PAST_DUE") return { key: "mora", label: "En mora" };
  if (s === "ACTIVE") return { key: "si", label: "Sí" };
  return { key: "no", label: "No" };
}

function getSubscriptionStatusLabel(status: any) {
  const s = String(status || "");
  if (s === "ACTIVE") return "Activa";
  if (s === "PAST_DUE") return "En mora";
  if (s === "SUSPENDED") return "Suspendida";
  if (s === "CANCELED") return "Cancelada";
  return s || "—";
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

function formatPlanTitle(plan: any) {
  const md = (plan?.metadata as any) || {};
  const displayName = String(md?.displayName || "").trim();
  const rawName = String(plan?.name || "").trim();
  const name = displayName || rawName.replace(/^\s*\[\d+\]\s*/, "").trim() || "—";
  const sku = normalizeSku(md?.sku);
  return sku ? `SKU ${sku} · ${name}` : name;
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
  try {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) {
    return (
      <main className="page pageWide">
        <p>Configura `ADMIN_API_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const sp = (await searchParams) ?? {};

  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const contactCreated = typeof sp.contactCreated === "string" ? sp.contactCreated : "";
  const checkoutUrl = typeof sp.checkoutUrl === "string" ? sp.checkoutUrl : "";
  const checkoutCustomerId = typeof sp.customerId === "string" ? sp.customerId : "";
  const tokenUrl = typeof sp.tokenUrl === "string" ? sp.tokenUrl : "";
  const chargeStatus = typeof sp.chargeStatus === "string" ? sp.chargeStatus : "";
  const chargeError = typeof sp.chargeError === "string" ? sp.chargeError : "";
  const paymentId = typeof sp.paymentId === "string" ? sp.paymentId : "";
  const actionSubscriptionId = typeof sp.subscriptionId === "string" ? sp.subscriptionId : "";
  const cutoffScheduled = typeof sp.cutoffScheduled === "string" ? sp.cutoffScheduled : "";
  const tenantsUpdated = typeof sp.tenantsUpdated === "string" ? sp.tenantsUpdated : "";
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : undefined);
  const central = typeof sp.central === "string" ? sp.central : "";
  const crear = typeof sp.crear === "string" ? sp.crear : "";
  const selectCustomerId = typeof sp.selectCustomerId === "string" ? sp.selectCustomerId : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;

  const tipo = typeof sp.tipo === "string" ? sp.tipo : "todos";
  const estado = typeof sp.estado === "string" ? sp.estado : "todos";
  const q = typeof sp.q === "string" ? sp.q : "";
  const ordenar = typeof sp.ordenar === "string" ? sp.ordenar : "vencimiento";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
  const returnTo = `/billing${tenantId || q || tipo !== "todos" || estado !== "todos" || ordenar !== "vencimiento" || viewId || filters || (Number.isFinite(page) && page > 1)
    ? `?${new URLSearchParams({
        ...(tenantId ? { tenantId } : {}),
        ...(q ? { q } : {}),
        ...(tipo ? { tipo } : {}),
        ...(estado ? { estado } : {}),
        ...(ordenar ? { ordenar } : {}),
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
  const take = 20;
  subParams.set("take", String(take));
  if (Number.isFinite(page) && page > 1) subParams.set("skip", String((Math.trunc(page) - 1) * take));
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

  const [subs, customers, products, templates, tenantsRes, settingsRes] = await Promise.all([
    fetchAdmin(`/admin/subscriptions?${subParams.toString()}`),
    fetchAdmin(tenantId ? `/admin/customers?take=200&tenantId=${encodeURIComponent(tenantId)}` : "/admin/customers?take=200"),
    fetchAdmin(tenantId ? `/admin/products?take=200&tenantId=${encodeURIComponent(tenantId)}` : "/admin/products?take=200"),
    fetchAdmin(tenantId ? `/admin/checkout-templates?tenantId=${encodeURIComponent(tenantId)}` : "/admin/checkout-templates"),
    fetchAdminCached("/admin/tenants", { ttlMs: 1500 }),
    fetchAdminCached("/admin/settings", { ttlMs: 1500 })
  ]);
  const subItems = (subs.json?.items ?? []) as any[];
  const total = Number(subs.json?.total ?? 0);
  const customerItems = (customers.json?.items ?? []) as any[];
  const productItems = (products.json?.items ?? []) as any[];
  const productById = new Map(productItems.map((p: any) => [String(p.id), p]));
  const checkoutTemplates = (templates.json?.items ?? []) as any[];
  const tenants = (tenantsRes.json?.items ?? []) as Array<{ id: string; name: string }>;
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));
  const settings = settingsRes.ok ? settingsRes.json : null;
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
      const customer = s.customer;
      const tipoTx = getTipo(plan);
      const activo = getActivo(s.status);
      const estadoInfo = getEstado(s.status);
      const ident =
        customer?.metadata?.identificacion ||
        customer?.metadata?.identificationNumber ||
        customer?.metadata?.documentNumber ||
        customer?.metadata?.document ||
        "";

      const tenantIds = Array.isArray(s.tenantIds) && s.tenantIds.length ? s.tenantIds : [s.tenantId || plan?.tenantId].filter(Boolean);
      const tenantNameList = tenantIds.map((id: string) => tenantById.get(String(id))).filter(Boolean) as string[];
      const totalInCents = Number(plan?.priceInCents || 0);
      const shippingInCents = Number(readPlanPricing((plan?.metadata as any) ?? {})?.shippingInCents || 0);
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
        customerTokenized:
          (typeof customer?.metadata?.wompi?.paymentSourceId === "number" && Number.isFinite(customer?.metadata?.wompi?.paymentSourceId)) ||
          (typeof customer?.metadata?.wompi?.paymentSourceId === "string" && /^\d+$/.test(customer?.metadata?.wompi?.paymentSourceId)) ||
          (typeof customer?.metadata?.wompi?.payment_source_id === "string" && /^\d+$/.test(customer?.metadata?.wompi?.payment_source_id)) ||
          (typeof customer?.metadata?.paymentSourceId === "string" && /^\d+$/.test(customer?.metadata?.paymentSourceId)) ||
          (typeof customer?.metadata?.payment_source_id === "string" && /^\d+$/.test(customer?.metadata?.payment_source_id)) ||
          (Array.isArray(customer?.metadata?.wompi?.paymentSources) && customer?.metadata?.wompi?.paymentSources.length > 0),
        identificacion: String(ident || "—"),
        tipoTx,
        tipoPago: getTipoPago(plan),
        activo,
        status: String(s.status || "—"),
        estadoInfo,
        planName: formatPlanTitle(plan),
        planImageUrl: String((plan?.metadata as any)?.imageUrl || (productById.get(String((plan?.metadata as any)?.catalog?.itemId || ""))?.imageUrl ?? "")),
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
        mode: String(plan?.collectionMode || plan?.metadata?.collectionMode || "MANUAL_LINK"),
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

  const paginationBase = {
    ...(tenantId ? { tenantId } : {}),
    ...(q ? { q } : {}),
    ...(tipo ? { tipo } : {}),
    ...(estado ? { estado } : {}),
    ...(ordenar ? { ordenar } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  };

  return (
    <main className="page pageWide">
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {contactCreated ? <div className="card cardPad">Contacto creado correctamente.</div> : null}
      {chargeStatus ? (
        <ChargeStatusModal
          initialStatus={chargeStatus === "processing" ? "processing" : chargeStatus === "ok" ? "ok" : "fail"}
          paymentId={paymentId}
          chargeError={chargeError}
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
                </div>
                <div className="field-hint tiny-total">{rows.length} resultados</div>
              </div>
            </div>
            <ListCsvActions exportHref={exportHref} tenantId={tenantId} defaultEntity="customers" />
          </div>
        </div>

        <div className="settings-group-body">
          <NewBillingAssignmentForm
            customers={customerItems}
            catalogItems={productItems}
            checkoutTemplates={checkoutTemplates}
            csrfToken={csrfToken}
            tenantId={tenantId}
            tenants={tenants}
            returnTo={returnTo}
            defaultOpen={Boolean(crear) || Boolean(selectCustomerId) || Boolean(contactCreated)}
            defaultSelectedCustomerId={selectCustomerId}
            createCustomer={createCustomerFromBilling}
            createPlanAndSubscription={createPlanAndSubscription}
          />

          <div className="billing-grid">
            {rows.map((r) => {
              const isPlan = r.mode !== "AUTO_DEBIT";
              const paymentStatus = getPaymentStatusLabel({
                status: r.status,
                paidAt: r.pagoAt,
                periodStartAt: r.periodoInicioAt,
                periodEndAt: r.periodoFinAt
              });
              const subscriptionStatus = getSubscriptionStatusLabel(r.status);
              const subscriptionBadge = `Suscripción ${subscriptionStatus.toLowerCase()}`;
              const planLinkStatus = getPlanLinkStatus(r.lastPaymentLink, r.pagoAt);
              const rowCheckoutUrl = checkoutCustomerId && checkoutCustomerId === r.customerId ? checkoutUrl : "";
              const rowTokenUrl = checkoutCustomerId && checkoutCustomerId === r.customerId ? tokenUrl : "";
              const sentForRow = central === "sent" && checkoutCustomerId && checkoutCustomerId === r.customerId;
              const chargedForRow = chargeStatus === "ok" && actionSubscriptionId === r.id;
              const cutoffForRow = cutoffScheduled && actionSubscriptionId === r.id;
              const tenantsUpdatedForRow = tenantsUpdated && actionSubscriptionId === r.id;
              const canSendToken = r.mode === "AUTO_DEBIT" && Boolean(subscriptionBaseUrl);
              return (
                <div className="billing-card" key={r.id}>
                  <div className="billing-header">
                    <div className="billing-title">
                      <div className="billing-name">{r.customerName}</div>
                      <div className="billing-sub">
                        {r.customerEmail || "—"} · {r.identificacion || "—"}
                      </div>
                      <div className="field-hint">{isPlan ? "Suscripción link de pago" : "Débito automático"}</div>
                    </div>
                    <div className="billing-header-middle">
                      <span className="billing-header-label">Canal de ventas</span>
                      <BillingTenantModalButton
                        triggerId={`tenant-modal-open-${r.id}`}
                        triggerLabel={r.tenantName || "Sin canal"}
                        triggerClassName="ghost btn-compact btn-noicon"
                        subscriptionId={r.id}
                        scopeTenantId={r.tenantId || ""}
                        tenantIds={Array.isArray(r.tenantIds) ? r.tenantIds.map(String) : []}
                        tenants={tenants}
                        csrfToken={csrfToken}
                        returnTo={returnTo}
                        action={updateSubscriptionTenants}
                      />
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
                        <a
                          className="ghost btn-compact btn-history btn-icon-only"
                          href={`/customers?${new URLSearchParams({
                            tx: r.customerId,
                            ...(r.tenantId ? { tenantId: r.tenantId } : {})
                          }).toString()}`}
                          aria-label="Historial"
                          title="Historial"
                        />
                        <DeleteSubscriptionButton action={deleteSubscription} csrfToken={csrfToken} subscriptionId={r.id} tenantId={r.tenantId} />
                      </div>
                    </div>
                  </div>
                  <div className="billing-badges">
                    <span className="provider-badge">
                      <img src="/brand/wompi.png" alt="" />
                      Wompi
                    </span>
                    {isPlan ? (
                      <span className={`pill ${planLinkStatus === "Pagado" ? "pill-ok" : planLinkStatus === "En mora" ? "pill-warn" : "pill-muted"}`}>
                        {planLinkStatus === "Link enviado" ? "Link enviado" : planLinkStatus}
                      </span>
                    ) : (
                      <>
                        <span className={`pill ${subscriptionStatus === "Activa" ? "pill-ok" : subscriptionStatus === "En mora" ? "pill-warn" : subscriptionStatus === "Suspendida" ? "pill-warn" : subscriptionStatus === "Cancelada" ? "pill-bad" : "pill-muted"}`}>
                          {subscriptionBadge}
                        </span>
                        <span className={`pill ${paymentStatus === "Pagado" ? "pill-ok" : paymentStatus === "En mora" ? "pill-warn" : "pill-muted"}`}>
                          Pago {paymentStatus.toLowerCase()}
                        </span>
                      </>
                    )}
                    <span className={`pill ${r.customerTokenized ? "pill-ok" : "pill-bad"}`}>
                      {r.customerTokenized ? "Tokenizada" : "Sin token"}
                    </span>
                  </div>

                  <div className="billing-grid-info" style={{ gridTemplateColumns: "1.7fr 1.2fr 0.9fr 0.9fr", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div className="product-thumb" style={{ width: 36, height: 36 }}>
                        {r.planImageUrl ? <img src={r.planImageUrl} alt={r.planName} /> : <span>📦</span>}
                      </div>
                      <div style={{ display: "grid", gap: 2 }}>
                        <span>Producto</span>
                        <strong>{r.planName}</strong>
                      </div>
                    </div>
                    <div>
                      <span>Próximo pago / corte</span>
                      {r.mode === "AUTO_DEBIT" && r.customerTokenized && r.status !== "CANCELED" ? (
                        <AutoCutoffInlineForm
                          subscriptionId={r.id}
                          csrfToken={csrfToken}
                          returnTo={returnTo}
                          tenantId={r.tenantId}
                          currentEndAt={r.vencimientoAt}
                          action={scheduleCutoff}
                        />
                      ) : (
                        <div>{r.vencimientoAt ? <LocalDateTime value={r.vencimientoAt} /> : "—"}</div>
                      )}
                    </div>
                    <div>
                      <span>Valor base</span>
                      <strong>{fmtMoney(r.valorBaseInCents ?? r.montoInCents, r.moneda)}</strong>
                      <div className="field-hint">{r.cada}</div>
                    </div>
                    <div>
                      <span>Flete</span>
                      {r.currentRequiresShipping ? (
                        <>
                          <strong>{r.currentShippingInCents > 0 ? fmtMoney(r.currentShippingInCents, r.moneda) : `Gratis (${fmtMoney(0, r.moneda)})`}</strong>
                          <div className="field-hint">Total suscripción</div>
                          <strong>{fmtMoney(r.totalInCents ?? r.montoInCents, r.moneda)}</strong>
                        </>
                      ) : (
                        <>
                          <strong>{fmtMoney(0, r.moneda)}</strong>
                          <div className="field-hint">Total suscripción</div>
                          <strong>{fmtMoney(r.totalInCents ?? r.montoInCents, r.moneda)}</strong>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="billing-actions">
                    <div className="billing-actions-left">
                      {r.mode === "AUTO_DEBIT" && r.status === "PAST_DUE" ? (
                        <form action={chargeSubscriptionNow}>
                          <input type="hidden" name="csrf" value={csrfToken} />
                          <input type="hidden" name="subscriptionId" value={r.id} />
                          {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                          <button
                            className="ghost btn-compact btn-noicon btn-blue btn-pay"
                            type="submit"
                            disabled={!r.customerTokenized}
                            title={
                              !r.customerTokenized
                                ? "Primero debes guardar tarjeta (débito automático)"
                                : "Cobrar ahora"
                            }
                          >
                            Cobrar
                          </button>
                        </form>
                      ) : null}
                    </div>
                    <div className="billing-actions-right">
                    {r.mode !== "AUTO_DEBIT" ? (
                      <form action={sendCentralComPaymentLink}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="subscriptionId" value={r.id} />
                        <input type="hidden" name="customerId" value={r.customerId} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                        <button className="ghost btn-compact btn-noicon btn-send" type="submit" title="Enviar por CentralCom">
                          Enviar link de pago
                        </button>
                      </form>
                    ) : (
                      <>
                        {canSendToken ? (
                          <form action={sendCentralComTokenizationLink}>
                            <input type="hidden" name="csrf" value={csrfToken} />
                            <input type="hidden" name="customerId" value={r.customerId} />
                            <input type="hidden" name="planId" value={r.planId} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                            <button className="ghost btn-compact btn-noicon btn-send" type="submit" title="Enviar por CentralCom">
                              Guardar tarjeta
                            </button>
                          </form>
                        ) : (
                          <a className="ghost btn-compact btn-amber btn-create" href="/settings?tab=checkout-publico">
                            Crear checkout
                          </a>
                        )}
                      </>
                    )}
                      {r.status === "SUSPENDED" ? (
                        <form action={resumeSubscription}>
                          <input type="hidden" name="csrf" value={csrfToken} />
                          <input type="hidden" name="subscriptionId" value={r.id} />
                          {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                          <button className="ghost btn-compact btn-noicon btn-green" type="submit">
                            Reanudar
                          </button>
                        </form>
                      ) : r.status === "CANCELED" ? (
                        <form action={activateSubscription}>
                          <input type="hidden" name="csrf" value={csrfToken} />
                          <input type="hidden" name="subscriptionId" value={r.id} />
                          {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                          <button className="ghost btn-compact btn-noicon btn-green" type="submit">
                            Activar
                          </button>
                        </form>
                      ) : (
                        <>
                          <form action={cancelSubscription}>
                            <input type="hidden" name="csrf" value={csrfToken} />
                            <input type="hidden" name="subscriptionId" value={r.id} />
                            {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                            <button className="ghost btn-compact btn-noicon btn-red" type="submit">
                              Cancelar
                            </button>
                          </form>
                          <form action={suspendSubscription}>
                            <input type="hidden" name="csrf" value={csrfToken} />
                            <input type="hidden" name="subscriptionId" value={r.id} />
                            {r.tenantId ? <input type="hidden" name="tenantId" value={r.tenantId} /> : null}
                            <button className="ghost btn-compact btn-noicon btn-amber" type="submit">
                              Suspender
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                    {(sentForRow || rowCheckoutUrl || rowTokenUrl || chargedForRow || cutoffForRow) ? (
                      <div className="field-hint" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {sentForRow ? <span>Enviado.</span> : null}
                        {chargedForRow ? <span>Cobro manual enviado.</span> : null}
                        {cutoffForRow ? <span>Fecha de corte actualizada.</span> : null}
                        {rowTokenUrl ? (
                          <>
                            <a className="ghost btn-compact btn-open" href={rowTokenUrl} target="_blank" rel="noreferrer">
                              Abrir checkout
                            </a>
                            <CopyButton text={rowTokenUrl} />
                          </>
                        ) : null}
                        {rowCheckoutUrl ? (
                          <>
                            <a className="ghost btn-compact btn-open" href={rowCheckoutUrl} target="_blank" rel="noreferrer">
                              Abrir link
                            </a>
                            <CopyButton text={rowCheckoutUrl} />
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {tenantsUpdatedForRow ? <div className="field-hint">Canales actualizados.</div> : null}
                  </div>
                </div>
              );
            })}
            {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
          </div>

          {(() => {
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
  } catch (err) {
    return (
      <main className="page pageWide">
        <p>No pudimos cargar esta sección. Detalle: {String((err as any)?.message || err)}</p>
      </main>
    );
  }
}
