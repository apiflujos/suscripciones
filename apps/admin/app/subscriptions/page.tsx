const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = process.env.API_ADMIN_TOKEN || "";

async function fetchAdmin(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export default async function SubscriptionsPage() {
  if (!TOKEN) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Suscripciones</h1>
        <p>Configura `API_ADMIN_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const data = await fetchAdmin("/admin/subscriptions");
  const items = (data.json?.items ?? []) as any[];

  return (
    <main>
      <h1 style={{ marginTop: 0 }}>Suscripciones</h1>
      <p>Últimas 50 suscripciones.</p>
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((s) => (
          <div key={s.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <strong>{s.plan?.name ?? "Plan"}</strong>
              <span style={{ color: "#666" }}>{s.status}</span>
              <span style={{ color: "#666" }}>ciclo: {s.currentCycle}</span>
            </div>
            <div style={{ marginTop: 8, color: "#333" }}>
              cliente: {s.customer?.email || s.customer?.name || s.customerId}
            </div>
            <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
              vence: {new Date(s.currentPeriodEndAt).toLocaleString()}
            </div>
          </div>
        ))}
        {items.length === 0 ? <div style={{ color: "#666" }}>Sin suscripciones.</div> : null}
      </div>
    </main>
  );
}

