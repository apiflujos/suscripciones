import { createCustomer } from "./actions";
import Link from "next/link";
import { NewCustomerForm } from "./NewCustomerForm";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchCustomers(opts?: { q?: string; take?: number }) {
  const sp = new URLSearchParams();
  const q = String(opts?.q || "").trim();
  const take = Number(opts?.take ?? 200);
  if (q) sp.set("q", q);
  if (Number.isFinite(take) && take > 0) sp.set("take", String(Math.min(Math.trunc(take), 500)));

  const path = sp.size ? `/admin/customers?${sp.toString()}` : "/admin/customers";
  const res = await fetchAdminCached(path, { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

export default async function CustomersPage({
  searchParams
}: {
  searchParams: { created?: string; paymentSource?: string; error?: string; q?: string };
}) {
  const { token } = getConfig();
  if (!token) return <main><h1 style={{ marginTop: 0 }}>Contactos</h1><p>Configura `ADMIN_API_TOKEN`.</p></main>;
  const q = typeof searchParams?.q === "string" ? searchParams.q : "";
  const data = await fetchCustomers({ q, take: 200 });
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
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Contactos</h3>
              <HelpTip text="Clientes y datos de contacto (email / teléfono). También permite guardar método de pago para cobros automáticos." />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <form action="/customers" method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="input" name="q" defaultValue={q} placeholder="Buscar..." />
                <button className="ghost" type="submit">
                  Buscar
                </button>
              </form>
              <span className="pill">{items.length} resultados</span>
            </div>
          </div>
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
