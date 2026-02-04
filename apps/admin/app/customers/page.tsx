import { createCustomer } from "./actions";

export const dynamic = "force-dynamic";

function getConfig() {
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token: process.env.API_ADMIN_TOKEN || ""
  };
}

async function fetchCustomers() {
  const { apiBase, token } = getConfig();
  if (!token) return { items: [] as any[] };
  const res = await fetch(`${apiBase}/admin/customers`, { cache: "no-store", headers: { authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({ items: [] }));
  return json;
}

export default async function CustomersPage({ searchParams }: { searchParams: { created?: string } }) {
  const { token } = getConfig();
  if (!token) return <main><h1 style={{ marginTop: 0 }}>Clientes</h1><p>Configura `API_ADMIN_TOKEN`.</p></main>;
  const data = await fetchCustomers();
  const items = (data.items ?? []) as any[];

  return (
    <main style={{ display: "grid", gap: 16, maxWidth: 820 }}>
      <h1 style={{ marginTop: 0 }}>Clientes</h1>
      {searchParams.created ? <div style={{ padding: 12, background: "#eef", borderRadius: 8 }}>Cliente creado.</div> : null}

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Nuevo cliente</h2>
        <form action={createCustomer} style={{ display: "grid", gap: 10 }}>
          <label>
            Nombre
            <input name="name" style={{ width: "100%" }} />
          </label>
          <label>
            Email
            <input name="email" style={{ width: "100%" }} />
          </label>
          <label>
            Teléfono
            <input name="phone" style={{ width: "100%" }} />
          </label>
          <button type="submit">Crear cliente</button>
        </form>
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Clientes recientes</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((c) => (
            <div key={c.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
              <strong>{c.email || c.name || c.id}</strong>
              <div style={{ color: "#666", marginTop: 6 }}>
                {c.name ? `Nombre: ${c.name} ` : ""}{c.phone ? `Tel: ${c.phone}` : ""}
              </div>
            </div>
          ))}
          {items.length === 0 ? <div style={{ color: "#666" }}>Sin clientes.</div> : null}
        </div>
      </section>
    </main>
  );
}
