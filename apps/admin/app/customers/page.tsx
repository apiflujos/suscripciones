import { createCustomer } from "./actions";
import Link from "next/link";
import { NewCustomerForm } from "./NewCustomerForm";

export const dynamic = "force-dynamic";

function getConfig() {
  const raw = String(process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || "");
  const token = raw.replace(/^Bearer\\s+/i, "").trim().replace(/^\"|\"$/g, "").replace(/^'|'$/g, "").trim();
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token
  };
}

async function fetchCustomers() {
  const { apiBase, token } = getConfig();
  if (!token) return { items: [] as any[] };
  const res = await fetch(`${apiBase}/admin/customers`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  });
  const json = await res.json().catch(() => ({ items: [] }));
  return json;
}

export default async function CustomersPage({ searchParams }: { searchParams: { created?: string; paymentSource?: string; error?: string } }) {
  const { token } = getConfig();
  if (!token) return <main><h1 style={{ marginTop: 0 }}>Contactos</h1><p>Configura `API_ADMIN_TOKEN` (o `ADMIN_API_TOKEN`).</p></main>;
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
      {searchParams.paymentSource ? <div className="card cardPad">Método de pago guardado.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Contactos</h3>
          <div className="field-hint">Clientes y datos de contacto (email / teléfono).</div>
        </div>

        <div className="settings-group-body">
          <NewCustomerForm createCustomer={createCustomer} />

          <div className="panel module" style={{ padding: 0 }}>
            <table className="table" aria-label="Tabla de contactos">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Identificación</th>
                  <th>Ciudad</th>
                  <th>Dirección</th>
                  <th>Cobro auto</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td>{c.phone || "—"}</td>
                    <td>{c.metadata?.identificacion || c.metadata?.identificationNumber || "—"}</td>
                    <td>{c.metadata?.address?.city || "—"}</td>
                    <td>{c.metadata?.address?.line1 || "—"}</td>
                    <td>
                      {c.metadata?.wompi?.paymentSourceId ? (
                        <span className="pill">OK</span>
                      ) : (
                        <Link href={`/customers/${c.id}/payment-method`} style={{ textDecoration: "underline" }}>
                          Agregar
                        </Link>
                      )}
                    </td>
                    <td>{c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ color: "var(--muted)" }}>
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
