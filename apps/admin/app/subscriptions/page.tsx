import { createPaymentLink, createSubscription } from "./actions";

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

export default async function SubscriptionsPage({
  searchParams
}: {
  searchParams: { created?: string; link?: string; checkoutUrl?: string };
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Suscripciones</h1>
        <p>Configura `API_ADMIN_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const [subs, plans, customers] = await Promise.all([
    fetchAdmin("/admin/subscriptions"),
    fetchAdmin("/admin/plans"),
    fetchAdmin("/admin/customers")
  ]);
  const items = (subs.json?.items ?? []) as any[];
  const planItems = (plans.json?.items ?? []) as any[];
  const customerItems = (customers.json?.items ?? []) as any[];

  return (
    <main style={{ display: "grid", gap: 16, maxWidth: 920 }}>
      <h1 style={{ marginTop: 0 }}>Suscripciones</h1>
      {searchParams.created ? <div style={{ padding: 12, background: "#eef", borderRadius: 8 }}>Suscripción creada.</div> : null}
      {searchParams.link ? <div style={{ padding: 12, background: "#eef", borderRadius: 8 }}>Link creado.</div> : null}
      {searchParams.checkoutUrl ? (
        <div style={{ padding: 12, background: "#efe", borderRadius: 8 }}>
          Checkout:{" "}
          <a href={searchParams.checkoutUrl} target="_blank" rel="noreferrer">
            abrir link
          </a>
        </div>
      ) : null}

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Nueva suscripción</h2>
        <form action={createSubscription} style={{ display: "grid", gap: 10 }}>
          <label>
            Cliente
            <select name="customerId" style={{ width: "100%" }}>
              {customerItems.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.email || c.name || c.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Plan
            <select name="planId" style={{ width: "100%" }}>
              {planItems.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.priceInCents} {p.currency})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input name="createPaymentLink" type="checkbox" defaultChecked />
            Crear link de pago y enviar por Chatwoot (si está configurado)
          </label>
          <button type="submit">Crear suscripción</button>
          {customerItems.length === 0 || planItems.length === 0 ? (
            <div style={{ color: "#b00" }}>Primero crea al menos 1 cliente y 1 plan.</div>
          ) : null}
        </form>
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Suscripciones recientes</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((s) => (
            <div key={s.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <strong>{s.plan?.name ?? "Plan"}</strong>
                <span style={{ color: "#666" }}>{s.status}</span>
                <span style={{ color: "#666" }}>ciclo: {s.currentCycle}</span>
                <form action={createPaymentLink} style={{ marginLeft: "auto" }}>
                  <input type="hidden" name="subscriptionId" value={s.id} />
                  <button type="submit">Generar link</button>
                </form>
              </div>
              <div style={{ marginTop: 8, color: "#333" }}>cliente: {s.customer?.email || s.customer?.name || s.customerId}</div>
              <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                vence: {new Date(s.currentPeriodEndAt).toLocaleString()}
              </div>
            </div>
          ))}
          {items.length === 0 ? <div style={{ color: "#666" }}>Sin suscripciones.</div> : null}
        </div>
      </section>
    </main>
  );
}
