import { createPaymentLink, createPlan, createSubscription } from "../subscriptions/actions";
import { SubscriptionDateFields } from "../subscriptions/SubscriptionDateFields";

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
  const checkoutUrl = typeof searchParams?.checkoutUrl === "string" ? searchParams.checkoutUrl : "";
  const error = typeof searchParams?.error === "string" ? searchParams.error : "";

  const [plans, subs, customers] = await Promise.all([
    fetchAdmin("/admin/plans"),
    fetchAdmin("/admin/subscriptions"),
    fetchAdmin("/admin/customers")
  ]);

  const planItems = (plans.json?.items ?? []) as any[];
  const subItems = (subs.json?.items ?? []) as any[];
  const customerItems = (customers.json?.items ?? []) as any[];

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Guardado.</div> : null}
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
          <h3>Planes y Suscripciones</h3>
          <div className="field-hint">Cobranza recurrente: link automático o débito tokenizado.</div>
        </div>

        <div className="settings-group-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="panel module">
              <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <h3>Planes</h3>
                <span className="settings-group-title">{planItems.length} total</span>
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
                  <select className="select" name="collectionMode" defaultValue="AUTO_DEBIT">
                    <option value="AUTO_DEBIT">AUTO_DEBIT (tokenización)</option>
                    <option value="AUTO_LINK">AUTO_LINK (link por ciclo)</option>
                    <option value="MANUAL_LINK">MANUAL_LINK (manual)</option>
                  </select>
                </div>

                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button className="primary" type="submit">
                    Crear plan
                  </button>
                </div>
              </form>

              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {planItems.map((p) => (
                  <div key={p.id} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
                    <strong>{p.name}</strong>
                    <div className="field-hint" style={{ marginTop: 6 }}>
                      {p.priceInCents} {p.currency} / {p.intervalCount} {p.intervalUnit}
                      {p.metadata?.collectionMode ? ` · ${p.metadata.collectionMode}` : ""}
                    </div>
                  </div>
                ))}
                {planItems.length === 0 ? <div className="field-hint">Sin planes.</div> : null}
              </div>
            </div>

            <div className="panel module">
              <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <h3>Suscripciones</h3>
                <span className="settings-group-title">{subItems.length} total</span>
              </div>

              <form action={createSubscription} style={{ display: "grid", gap: 10 }}>
                <div className="field">
                  <label>Cliente</label>
                  <select className="select" name="customerId" required>
                    {customerItems.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.email || c.name || c.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Plan</label>
                  <select className="select" name="planId" required>
                    {planItems.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.priceInCents} {p.currency})
                      </option>
                    ))}
                  </select>
                </div>

                <SubscriptionDateFields />

                <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
                  <input name="createPaymentLink" type="checkbox" defaultChecked />
                  <span>Crear link (si aplica) y enviar por Chatwoot</span>
                </label>

                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button className="primary" type="submit">
                    Crear suscripción
                  </button>
                </div>
              </form>

              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {subItems.slice(0, 30).map((s) => (
                  <div key={s.id} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{s.plan?.name ?? "Suscripción"}</strong>
                      <span className="field-hint">{s.status}</span>
                      <form action={createPaymentLink} style={{ marginLeft: "auto" }}>
                        <input type="hidden" name="subscriptionId" value={s.id} />
                        <button className="ghost" type="submit">
                          Generar link
                        </button>
                      </form>
                    </div>
                    <div className="field-hint" style={{ marginTop: 6 }}>
                      cliente: {s.customer?.email || s.customer?.name || s.customerId}
                    </div>
                  </div>
                ))}
                {subItems.length === 0 ? <div className="field-hint">Sin suscripciones.</div> : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

