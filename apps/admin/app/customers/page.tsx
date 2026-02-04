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

export default async function CustomersPage({ searchParams }: { searchParams: { created?: string; error?: string } }) {
  const { token } = getConfig();
  if (!token) return <main><h1 style={{ marginTop: 0 }}>Contactos</h1><p>Configura `API_ADMIN_TOKEN`.</p></main>;
  const data = await fetchCustomers();
  const items = (data.items ?? []) as any[];

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      {searchParams.error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {searchParams.error}
        </div>
      ) : null}
      {searchParams.created ? <div className="card cardPad">Contacto creado.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Contactos</h3>
          <div className="field-hint">Clientes y datos de contacto (email / teléfono).</div>
        </div>

        <div className="settings-group-body">
          <div className="panel module">
            <div className="panel-header">
              <h3>Nuevo contacto</h3>
            </div>
            <form action={createCustomer} style={{ display: "grid", gap: 10 }}>
              <div className="field">
                <label>Nombre</label>
                <input className="input" name="name" placeholder="Nombre" />
              </div>
              <div className="field">
                <label>Email</label>
                <input className="input" name="email" placeholder="correo@empresa.com" />
              </div>
              <div className="field">
                <label>Teléfono</label>
                <input className="input" name="phone" placeholder="+57..." />
              </div>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="primary" type="submit">
                  Crear contacto
                </button>
              </div>
              <div className="field-hint">Tip: con email puedes identificar más fácil al cliente en suscripciones.</div>
            </form>
          </div>

          <div className="panel module" style={{ padding: 0 }}>
            <table className="table" aria-label="Tabla de contactos">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td>{c.phone || "—"}</td>
                    <td>{c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--muted)" }}>
                      Sin contactos.
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
