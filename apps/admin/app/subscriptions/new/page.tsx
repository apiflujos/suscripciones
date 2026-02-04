import Link from "next/link";
import { createSubscription } from "../actions";
import { SubscriptionDateFields } from "../SubscriptionDateFields";

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

export default async function NewSubscriptionPage({
  searchParams
}: {
  searchParams: { error?: string };
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Nueva suscripción</h1>
        <p>Configura `API_ADMIN_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const [plans, customers] = await Promise.all([fetchAdmin("/admin/plans"), fetchAdmin("/admin/customers")]);
  const planItems = (plans.json?.items ?? []) as any[];
  const customerItems = (customers.json?.items ?? []) as any[];

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      {searchParams.error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {searchParams.error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Nueva suscripción</h3>
          <div className="field-hint">Crea una suscripción usando un plan (tipo) existente.</div>
        </div>

        <div className="settings-group-body">
          <div className="panel module">
            <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <h3>Datos</h3>
              <span className="settings-group-title">
                <Link href="/plans" style={{ textDecoration: "underline" }}>
                  Administrar planes
                </Link>
              </span>
            </div>

            <form action={createSubscription} style={{ display: "grid", gap: 10 }}>
              <div className="field">
                <label>Cliente</label>
                <select className="select" name="customerId" required>
                  {customerItems.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.email || c.name || c.id}
                      {c.metadata?.wompi?.paymentSourceId ? "" : " · sin método auto"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Tipo de suscripción (plan)</label>
                <select className="select" name="planId" required>
                  {planItems.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.priceInCents} {p.currency} / {p.intervalCount} {p.intervalUnit})
                      {p.metadata?.collectionMode ? ` · ${p.metadata.collectionMode}` : ""}
                    </option>
                  ))}
                </select>
                <div className="field-hint">El precio y la periodicidad se toman del plan.</div>
                <div className="field-hint">
                  Si el plan es `AUTO_DEBIT`, el contacto debe tener método de pago guardado (columna “Cobro auto” en Contactos).
                </div>
              </div>

              <SubscriptionDateFields />

              <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
                <input name="createPaymentLink" type="checkbox" defaultChecked />
                <span>Crear link de pago y enviar por Chatwoot (si está configurado)</span>
              </label>

              <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <Link className="btn" href="/subscriptions">
                  Ver suscripciones
                </Link>
                <button className="primary" type="submit" disabled={customerItems.length === 0 || planItems.length === 0}>
                  Crear suscripción
                </button>
              </div>

              {customerItems.length === 0 || planItems.length === 0 ? (
                <div className="field-hint" style={{ color: "#a94442" }}>
                  Primero crea al menos 1 cliente y 1 plan.
                </div>
              ) : null}
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
