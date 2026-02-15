import { activateSubscription, cancelSubscription, createPaymentLink, deleteSubscription, resumeSubscription, suspendSubscription } from "../subscriptions/actions";
import { DeleteSubscriptionButton } from "./DeleteSubscriptionButton";
import { createCustomerFromBilling, createPlanAndSubscription, sendChatwootPaymentLink } from "./actions";
import { NewBillingAssignmentForm } from "./NewBillingAssignmentForm";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { LocalDateTime } from "../ui/LocalDateTime";
import { HelpTip } from "../ui/HelpTip";
import { CopyButton } from "../ui/CopyButton";
import { getCsrfToken } from "../lib/csrf";

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
  const mode = String(plan?.metadata?.collectionMode || "MANUAL_LINK");
  return mode === "AUTO_DEBIT" ? "Suscripción" : "Plan";
}

function getTipoPago(plan: any) {
  const mode = String(plan?.metadata?.collectionMode || "");
  if (mode === "AUTO_DEBIT") return "Pago suscripción";
  if (mode === "AUTO_LINK") return "Pago del plan";
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
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Planes y Suscripciones</h1>
        <p>Configura `ADMIN_API_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const sp = (await searchParams) ?? {};

  const created = typeof sp.created === "string" ? sp.created : "";
  const suspended = typeof sp.suspended === "string" ? sp.suspended : "";
  const canceled = typeof sp.canceled === "string" ? sp.canceled : "";
  const resumed = typeof sp.resumed === "string" ? sp.resumed : "";
  const activated = typeof sp.activated === "string" ? sp.activated : "";
  const deleted = typeof sp.deleted === "string" ? sp.deleted : "";
  const contactCreated = typeof sp.contactCreated === "string" ? sp.contactCreated : "";
  const checkoutUrl = typeof sp.checkoutUrl === "string" ? sp.checkoutUrl : "";
  const checkoutCustomerId = typeof sp.customerId === "string" ? sp.customerId : "";
  const error = typeof sp.error === "string" ? sp.error : "";
  const chatwoot = typeof sp.chatwoot === "string" ? sp.chatwoot : "";
  const crear = typeof sp.crear === "string" ? sp.crear : "";
  const selectCustomerId = typeof sp.selectCustomerId === "string" ? sp.selectCustomerId : "";

  const tipo = typeof sp.tipo === "string" ? sp.tipo : "todos";
  const estado = typeof sp.estado === "string" ? sp.estado : "todos";
  const q = typeof sp.q === "string" ? sp.q : "";
  const ordenar = typeof sp.ordenar === "string" ? sp.ordenar : "vencimiento";
  const smartListRules = buildSmartListRules({ tipo, estado, q });
  const smartListRulesParam = encodeURIComponent(JSON.stringify(smartListRules));
  const hasFiltersApplied = tipo !== "todos" || estado !== "todos" || Boolean(q.trim());

  const subParams = new URLSearchParams();
  subParams.set("take", "300");
  if (q.trim()) subParams.set("q", q.trim());
  if (estado !== "todos") subParams.set("estado", estado);
  if (tipo === "suscripciones") subParams.set("collectionMode", "AUTO_DEBIT");
  if (tipo === "planes") subParams.set("collectionMode", "MANUAL_LINK");

  const [subs, customers, products] = await Promise.all([
    fetchAdmin(`/admin/subscriptions?${subParams.toString()}`),
    fetchAdmin("/admin/customers?take=200"),
    fetchAdmin("/admin/products?take=200")
  ]);
  const subItems = (subs.json?.items ?? []) as any[];
  const customerItems = (customers.json?.items ?? []) as any[];
  const productItems = (products.json?.items ?? []) as any[];

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

      return {
        id: String(s.id),
        customerId: String(s.customerId || ""),
        customerName: String(customer?.name || customer?.email || s.customerId || "—"),
        customerEmail: String(customer?.email || ""),
        customerTokenized:
          (typeof customer?.metadata?.wompi?.paymentSourceId === "number" && Number.isFinite(customer?.metadata?.wompi?.paymentSourceId)) ||
          (typeof customer?.metadata?.wompi?.paymentSourceId === "string" && /^\d+$/.test(customer?.metadata?.wompi?.paymentSourceId)) ||
          (typeof customer?.metadata?.wompi?.payment_source_id === "string" && /^\d+$/.test(customer?.metadata?.wompi?.payment_source_id)) ||
          (typeof customer?.metadata?.paymentSourceId === "string" && /^\d+$/.test(customer?.metadata?.paymentSourceId)) ||
          (typeof customer?.metadata?.payment_source_id === "string" && /^\d+$/.test(customer?.metadata?.payment_source_id)),
        identificacion: String(ident || "—"),
        tipoTx,
        tipoPago: getTipoPago(plan),
        activo,
        status: String(s.status || "—"),
        estadoInfo,
        planName: String(plan?.name || "—"),
        montoInCents: Number(plan?.priceInCents || 0),
        moneda: String(plan?.currency || "COP"),
        cada: fmtEvery(plan?.intervalUnit, plan?.intervalCount),
        pagoAt: s.lastPayment?.paidAt || null,
        vencimientoAt: s.currentPeriodEndAt || null,
        periodoInicioAt: s.currentPeriodStartAt || null,
        periodoFinAt: s.currentPeriodEndAt || null,
        mode: String(plan?.metadata?.collectionMode || "MANUAL_LINK")
      };
    })
    .filter((r) => {
      if (tipo === "planes" && r.tipoTx !== "Plan") return false;
      if (tipo === "suscripciones" && r.tipoTx !== "Suscripción") return false;
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

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Guardado.</div> : null}
      {suspended ? <div className="card cardPad">Suscripción suspendida.</div> : null}
      {canceled ? <div className="card cardPad">Suscripción cancelada.</div> : null}
      {resumed ? <div className="card cardPad">Suscripción reanudada.</div> : null}
      {activated ? <div className="card cardPad">Suscripción activada.</div> : null}
      {deleted ? <div className="card cardPad">Suscripción eliminada.</div> : null}
      {chatwoot === "sent" ? <div className="card cardPad">Mensaje enviado por Chatwoot.</div> : null}
      {contactCreated ? <div className="card cardPad">Contacto creado.</div> : null}
      {checkoutUrl ? (
        <div className="card cardPad" style={{ display: "grid", gap: 8 }}>
          <div>
            Checkout:{" "}
            <a href={checkoutUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              abrir link
            </a>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <CopyButton text={checkoutUrl} />
            <form action={sendChatwootPaymentLink}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="checkoutUrl" value={checkoutUrl} />
              <input type="hidden" name="customerId" value={checkoutCustomerId} />
              <button className="ghost" type="submit" disabled={!checkoutCustomerId}>
                Enviar por Chatwoot
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
            <h3>Planes y Suscripciones</h3>
          </div>
          <div className="filtersRow">
            <div className="filtersLeft">
              <div className="filter-group">
                <div className="filter-label">Filtros</div>
                <form action="/billing" method="GET" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span className="field-hint" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      Tipo
                      <HelpTip text="Filtra por planes (links de pago) o suscripciones (cobro automático)." />
                    </span>
                    <select className="select" name="tipo" defaultValue={tipo} aria-label="Tipo">
                    <option value="todos">Todos</option>
                    <option value="planes">Planes</option>
                    <option value="suscripciones">Suscripciones</option>
                    </select>
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span className="field-hint" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      Estado de pago
                      <HelpTip text="Sí = activo, No = inactivo, En mora = pago vencido." />
                    </span>
                    <select className="select" name="estado" defaultValue={estado} aria-label="Estado de pago">
                    <option value="todos">Todos</option>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                    <option value="mora">En mora</option>
                    </select>
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span className="field-hint">Ordenar</span>
                    <select className="select" name="ordenar" defaultValue={ordenar} aria-label="Ordenar">
                    <option value="vencimiento">Próximo pago</option>
                    <option value="pago">Pago</option>
                    <option value="monto">Monto</option>
                    </select>
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span className="field-hint">Buscar</span>
                    <input className="input" name="q" defaultValue={q} placeholder="Nombre, email o identificación..." />
                  </div>
                  <button className="ghost" type="submit">
                    Aplicar
                  </button>
                </form>
              </div>
            </div>
            <div className="filtersRight" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {hasFiltersApplied ? (
                <a className="ghost" href={`/smart-lists?rules=${smartListRulesParam}`}>
                  Crear lista inteligente
                </a>
              ) : null}
              <span className="pill">{rows.length} resultados</span>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          <NewBillingAssignmentForm
            customers={customerItems}
            catalogItems={productItems}
            csrfToken={csrfToken}
            defaultOpen={Boolean(crear) || Boolean(selectCustomerId) || Boolean(contactCreated)}
            defaultSelectedCustomerId={selectCustomerId}
            createCustomer={createCustomerFromBilling}
            createPlanAndSubscription={createPlanAndSubscription}
          />

          <div className="billing-grid">
            {rows.map((r) => {
              const paymentStatus = getPaymentStatusLabel({
                status: r.status,
                paidAt: r.pagoAt,
                periodStartAt: r.periodoInicioAt,
                periodEndAt: r.periodoFinAt
              });
              const subscriptionStatus = getSubscriptionStatusLabel(r.status);
              return (
                <div className="billing-card" key={r.id}>
                  <div className="billing-header">
                    <div className="billing-title">
                      <div className="billing-name">{r.customerName}</div>
                      <div className="billing-sub">
                        {r.customerEmail || "—"} · {r.identificacion || "—"}
                      </div>
                    </div>
                    <div className="billing-badges">
                      <span className={`pill ${r.customerTokenized ? "pill-ok" : "pill-bad"}`}>
                        {r.customerTokenized ? "Tokenizada" : "Sin token"}
                      </span>
                      <span className="pill pill-muted">{r.tipoTx}</span>
                    </div>
                  </div>

                  <div className="billing-grid-info">
                    <div>
                      <span>Plan / Producto</span>
                      <strong>{r.planName}</strong>
                    </div>
                    <div>
                      <span>Tipo de pago</span>
                      <strong>{r.tipoPago}</strong>
                    </div>
                    <div>
                      <span>Estado suscripción</span>
                      <span className={`pill ${subscriptionStatus === "Activa" ? "pill-ok" : subscriptionStatus === "En mora" ? "pill-warn" : subscriptionStatus === "Suspendida" ? "pill-warn" : subscriptionStatus === "Cancelada" ? "pill-bad" : "pill-muted"}`}>
                        {subscriptionStatus}
                      </span>
                    </div>
                    <div>
                      <span>Estado pago</span>
                      <span className={`pill ${paymentStatus === "Pagado" ? "pill-ok" : paymentStatus === "En mora" ? "pill-warn" : "pill-muted"}`}>
                        {paymentStatus}
                      </span>
                    </div>
                    <div>
                      <span>Último pago</span>
                      {r.pagoAt ? <LocalDateTime value={r.pagoAt} /> : "—"}
                    </div>
                    <div>
                      <span>Próximo pago</span>
                      {r.vencimientoAt ? <LocalDateTime value={r.vencimientoAt} /> : "—"}
                    </div>
                    <div>
                      <span>Monto</span>
                      <strong>{fmtMoney(r.montoInCents, r.moneda)}</strong>
                      <div className="field-hint">{r.cada}</div>
                    </div>
                  </div>

                  <div className="billing-actions">
                    {r.mode !== "AUTO_DEBIT" ? (
                      <form action={createPaymentLink}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="subscriptionId" value={r.id} />
                        <input type="hidden" name="customerId" value={r.customerId} />
                        <button className="ghost btn-compact btn-blue" type="submit">
                          Generar link
                        </button>
                      </form>
                    ) : (
                      <>
                        {r.status === "SUSPENDED" ? (
                          <form action={resumeSubscription}>
                            <input type="hidden" name="csrf" value={csrfToken} />
                            <input type="hidden" name="subscriptionId" value={r.id} />
                            <button className="ghost btn-compact btn-green" type="submit">
                              Reanudar
                            </button>
                          </form>
                        ) : r.status === "CANCELED" ? (
                          <form action={activateSubscription}>
                            <input type="hidden" name="csrf" value={csrfToken} />
                            <input type="hidden" name="subscriptionId" value={r.id} />
                            <button className="ghost btn-compact btn-green" type="submit">
                              Activar
                            </button>
                          </form>
                        ) : (
                          <>
                            <form action={suspendSubscription}>
                              <input type="hidden" name="csrf" value={csrfToken} />
                              <input type="hidden" name="subscriptionId" value={r.id} />
                              <button className="ghost btn-compact btn-amber" type="submit">
                                Suspender
                              </button>
                            </form>
                            <form action={cancelSubscription}>
                              <input type="hidden" name="csrf" value={csrfToken} />
                              <input type="hidden" name="subscriptionId" value={r.id} />
                              <button className="ghost btn-compact btn-red" type="submit">
                                Cancelar
                              </button>
                            </form>
                          </>
                        )}
                      </>
                    )}
                    <DeleteSubscriptionButton action={deleteSubscription} csrfToken={csrfToken} subscriptionId={r.id} />
                  </div>
                </div>
              );
            })}
            {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
