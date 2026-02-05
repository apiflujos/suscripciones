import { createPaymentLink, createSubscription } from "../subscriptions/actions";
import { createCustomerFromBilling } from "./actions";
import { NewBillingAssignmentForm } from "./NewBillingAssignmentForm";

export const dynamic = "force-dynamic";

function getConfig() {
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token: process.env.API_ADMIN_TOKEN || ""
  };
}

async function fetchAdmin(path: string) {
  const { apiBase, token } = getConfig();
  const res = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
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

function getActivo(status: any) {
  return String(status || "") !== "CANCELED";
}

function getSituacion(status: any) {
  const s = String(status || "");
  if (s === "ACTIVE") return { key: "al_dia", label: "Al día" };
  if (s === "PAST_DUE") return { key: "mora", label: "En mora" };
  if (s === "SUSPENDED") return { key: "mora", label: "Suspendida" };
  if (s === "EXPIRED") return { key: "mora", label: "Expirada" };
  if (s === "CANCELED") return { key: "mora", label: "Cancelada" };
  return { key: "mora", label: s || "—" };
}

function toLocal(dt: any) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default async function BillingPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Planes y Suscripciones</h1>
        <p>Configura `API_ADMIN_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const created = typeof searchParams?.created === "string" ? searchParams.created : "";
  const contactCreated = typeof searchParams?.contactCreated === "string" ? searchParams.contactCreated : "";
  const selectCustomerId = typeof searchParams?.selectCustomerId === "string" ? searchParams.selectCustomerId : "";
  const checkoutUrl = typeof searchParams?.checkoutUrl === "string" ? searchParams.checkoutUrl : "";
  const error = typeof searchParams?.error === "string" ? searchParams.error : "";

  const tipo = typeof searchParams?.tipo === "string" ? searchParams.tipo : "todos";
  const estado = typeof searchParams?.estado === "string" ? searchParams.estado : "activos";
  const situacion = typeof searchParams?.situacion === "string" ? searchParams.situacion : "todos";
  const q = typeof searchParams?.q === "string" ? searchParams.q : "";
  const ordenar = typeof searchParams?.ordenar === "string" ? searchParams.ordenar : "vencimiento";

  const [subs, plans, customers] = await Promise.all([
    fetchAdmin("/admin/subscriptions"),
    fetchAdmin("/admin/plans?take=300"),
    fetchAdmin("/admin/customers?take=200")
  ]);
  const subItems = (subs.json?.items ?? []) as any[];
  const planItems = (plans.json?.items ?? []) as any[];
  const customerItems = (customers.json?.items ?? []) as any[];

  const rows = subItems
    .map((s) => {
      const plan = s.plan;
      const customer = s.customer;
      const tipoTx = getTipo(plan);
      const activo = getActivo(s.status);
      const sit = getSituacion(s.status);
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
        identificacion: String(ident || "—"),
        tipoTx,
        activo,
        status: String(s.status || "—"),
        situacion: sit,
        planName: String(plan?.name || "—"),
        montoInCents: Number(plan?.priceInCents || 0),
        moneda: String(plan?.currency || "COP"),
        cada: fmtEvery(plan?.intervalUnit, plan?.intervalCount),
        pagoAt: s.lastPayment?.paidAt || null,
        vencimientoAt: s.currentPeriodEndAt || null,
        mode: String(plan?.metadata?.collectionMode || "MANUAL_LINK")
      };
    })
    .filter((r) => {
      if (tipo === "planes" && r.tipoTx !== "Plan") return false;
      if (tipo === "suscripciones" && r.tipoTx !== "Suscripción") return false;
      if (estado === "activos" && !r.activo) return false;
      if (estado === "inactivos" && r.activo) return false;
      if (situacion === "al_dia" && r.situacion.key !== "al_dia") return false;
      if (situacion === "mora" && r.situacion.key !== "mora") return false;
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
      {contactCreated ? <div className="card cardPad">Contacto creado.</div> : null}
      {checkoutUrl ? (
        <div className="card cardPad">
          Checkout:{" "}
          <a href={checkoutUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
            abrir link
          </a>
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
                  <select className="select" name="tipo" defaultValue={tipo} aria-label="Tipo">
                    <option value="todos">Todos</option>
                    <option value="planes">Planes</option>
                    <option value="suscripciones">Suscripciones</option>
                  </select>
                  <select className="select" name="estado" defaultValue={estado} aria-label="Estado">
                    <option value="activos">Activos</option>
                    <option value="inactivos">Inactivos</option>
                    <option value="todos">Todos</option>
                  </select>
                  <select className="select" name="situacion" defaultValue={situacion} aria-label="Situación">
                    <option value="todos">Todas</option>
                    <option value="al_dia">Al día</option>
                    <option value="mora">En mora</option>
                  </select>
                  <select className="select" name="ordenar" defaultValue={ordenar} aria-label="Ordenar">
                    <option value="vencimiento">Vencimiento</option>
                    <option value="pago">Pago</option>
                    <option value="monto">Monto</option>
                  </select>
                  <input className="input" name="q" defaultValue={q} placeholder="Buscar cliente o identificación..." />
                  <button className="ghost" type="submit">
                    Aplicar
                  </button>
                </form>
              </div>
            </div>
            <div className="filtersRight">
              <span className="pill">{rows.length} resultados</span>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          <div style={{ marginBottom: 14 }}>
            <NewBillingAssignmentForm
              plans={planItems}
              customers={customerItems}
              createSubscription={createSubscription}
              createCustomer={createCustomerFromBilling}
              preselectCustomerId={selectCustomerId || undefined}
            />
          </div>

          <div className="panel module" style={{ padding: 0 }}>
            <table className="table" aria-label="Tabla de planes y suscripciones">
              <thead>
                <tr>
                  <th>Fecha de pago</th>
                  <th>Fecha de vencimiento</th>
                  <th>Cliente</th>
                  <th>Identificación</th>
                  <th>Tipo</th>
                  <th>Activo</th>
                  <th>Estado</th>
                  <th>Monto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{toLocal(r.pagoAt)}</td>
                    <td>{toLocal(r.vencimientoAt)}</td>
                    <td>
                      <div style={{ display: "grid" }}>
                        <span>{r.customerName}</span>
                        {r.customerEmail ? <span className="field-hint">{r.customerEmail}</span> : null}
                        {r.customerId ? <span className="field-hint">ID: {r.customerId}</span> : null}
                      </div>
                    </td>
                    <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>{r.identificacion}</td>
                    <td>
                      <div style={{ display: "grid" }}>
                        <span>{r.tipoTx}</span>
                        <span className="field-hint">{r.planName}</span>
                      </div>
                    </td>
                    <td>{r.activo ? "Sí" : "No"}</td>
                    <td>
                      <div style={{ display: "grid" }}>
                        <span>{r.situacion.label}</span>
                        <span className="field-hint">{r.status}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "grid" }}>
                        <span>{fmtMoney(r.montoInCents, r.moneda)}</span>
                        <span className="field-hint">{r.cada}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {r.mode !== "AUTO_DEBIT" ? (
                        <form action={createPaymentLink}>
                          <input type="hidden" name="subscriptionId" value={r.id} />
                          <button className="ghost" type="submit">
                            Generar link
                          </button>
                        </form>
                      ) : (
                        <span className="field-hint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ color: "var(--muted)" }}>
                      Sin resultados.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
