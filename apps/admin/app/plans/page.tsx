import { createPlan } from "./actions";

export const dynamic = "force-dynamic";

function getConfig() {
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token: process.env.API_ADMIN_TOKEN || ""
  };
}

async function fetchPlans() {
  const { apiBase, token } = getConfig();
  if (!token) return { items: [] as any[] };
  const res = await fetch(`${apiBase}/admin/plans`, { cache: "no-store", headers: { authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({ items: [] }));
  return json;
}

export default async function PlansPage({ searchParams }: { searchParams: { created?: string } }) {
  const { token } = getConfig();
  if (!token) return <main><h1 style={{ marginTop: 0 }}>Planes</h1><p>Configura `API_ADMIN_TOKEN`.</p></main>;
  const data = await fetchPlans();
  const items = (data.items ?? []) as any[];

  return (
    <main style={{ display: "grid", gap: 16, maxWidth: 820 }}>
      <h1 style={{ marginTop: 0 }}>Planes</h1>
      {searchParams.created ? <div style={{ padding: 12, background: "#eef", borderRadius: 8 }}>Plan creado.</div> : null}

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Nuevo plan</h2>
        <form action={createPlan} style={{ display: "grid", gap: 10 }}>
          <label>
            Nombre del producto
            <input name="name" style={{ width: "100%" }} />
          </label>
          <label>
            Precio (centavos)
            <input name="priceInCents" defaultValue="49000" style={{ width: "100%" }} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              Moneda
              <input name="currency" defaultValue="COP" style={{ width: "100%" }} />
            </label>
            <label>
              Unidad
              <select name="intervalUnit" defaultValue="MONTH" style={{ width: "100%" }}>
                <option value="DAY">DAY</option>
                <option value="WEEK">WEEK</option>
                <option value="MONTH">MONTH</option>
                <option value="CUSTOM">CUSTOM</option>
              </select>
            </label>
          </div>
          <label>
            Cada cuántas unidades (intervalCount)
            <input name="intervalCount" defaultValue="1" style={{ width: "100%" }} />
          </label>
          <button type="submit">Crear plan</button>
        </form>
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Planes existentes</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((p) => (
            <div key={p.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
              <strong>{p.name}</strong>
              <div style={{ color: "#666", marginTop: 6 }}>
                {p.priceInCents} {p.currency} / {p.intervalCount} {p.intervalUnit}
              </div>
            </div>
          ))}
          {items.length === 0 ? <div style={{ color: "#666" }}>Sin planes.</div> : null}
        </div>
      </section>
    </main>
  );
}
