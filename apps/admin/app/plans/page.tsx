import Link from "next/link";
import { createPlan } from "../subscriptions/actions";

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

export default async function PlansPage({
  searchParams
}: {
  searchParams: { planCreated?: string; error?: string };
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Planes</h1>
        <p>Configura `API_ADMIN_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const plans = await fetchAdmin("/admin/plans");
  const items = (plans.json?.items ?? []) as any[];

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      {searchParams.error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {searchParams.error}
        </div>
      ) : null}
      {searchParams.planCreated ? <div className="card cardPad">Plan creado.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Planes</h3>
          <div className="field-hint">Aquí defines los tipos de suscripción: nombre, precio y periodicidad.</div>
        </div>

        <div className="settings-group-body">
          <div className="panel module">
            <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <h3>Nuevo plan</h3>
              <span className="settings-group-title">
                <Link href="/subscriptions" style={{ textDecoration: "underline" }}>
                  Ver suscripciones
                </Link>
              </span>
            </div>

            <form action={createPlan} style={{ display: "grid", gap: 10 }}>
              <div className="field">
                <label>Nombre</label>
                <input className="input" name="name" placeholder="Ej: Mensual – Olivia Shoes" required />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Precio (centavos)</label>
                  <input className="input" name="priceInCents" defaultValue="49000" inputMode="numeric" />
                </div>
                <div className="field">
                  <label>Moneda</label>
                  <input className="input" name="currency" defaultValue="COP" />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Unidad</label>
                  <select className="select" name="intervalUnit" defaultValue="MONTH">
                    <option value="DAY">DAY</option>
                    <option value="WEEK">WEEK</option>
                    <option value="MONTH">MONTH</option>
                    <option value="CUSTOM">CUSTOM</option>
                  </select>
                </div>
                <div className="field">
                  <label>Cada</label>
                  <input className="input" name="intervalCount" defaultValue="1" inputMode="numeric" />
                </div>
              </div>

              <div className="field">
                <label>Método de cobro</label>
                <select className="select" name="collectionMode" defaultValue="MANUAL_LINK">
                  <option value="MANUAL_LINK">MANUAL_LINK (link bajo demanda)</option>
                  <option value="AUTO_LINK">AUTO_LINK (auto-generar link por ciclo)</option>
                  <option value="AUTO_DEBIT">AUTO_DEBIT (cobro automático tokenizado)</option>
                </select>
                <div className="field-hint">
                  MANUAL: el admin genera el link cuando lo necesite. AUTO_LINK: el sistema genera/envía link en la fecha de corte.
                  AUTO_DEBIT: el sistema intenta cobrar sin link (requiere método de pago guardado en el contacto).
                </div>
              </div>

              <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <Link className="btn" href="/subscriptions/new">
                  Nueva suscripción
                </Link>
                <button className="primary" type="submit">
                  Crear plan
                </button>
              </div>
            </form>
          </div>

          <div className="panel module">
            <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <h3>Planes existentes</h3>
              <span className="settings-group-title">{items.length} total</span>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {items.map((p) => (
                <div key={p.id} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
                  <strong>{p.name}</strong>
                  <div className="field-hint" style={{ marginTop: 6 }}>
                    {p.priceInCents} {p.currency} / {p.intervalCount} {p.intervalUnit}
                    {p.metadata?.collectionMode ? ` · ${p.metadata.collectionMode}` : ""}
                    {p.active === false ? " · inactivo" : ""}
                  </div>
                </div>
              ))}
              {items.length === 0 ? <div className="field-hint">Sin planes.</div> : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
