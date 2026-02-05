import { createPlanTemplate } from "./actions";
import { NewPlanOrSubscriptionForm } from "./NewPlanOrSubscriptionForm";

export const dynamic = "force-dynamic";

function getConfig() {
  const raw = String(process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || "");
  const token = raw.replace(/^Bearer\\s+/i, "").trim().replace(/^\"|\"$/g, "").replace(/^'|'$/g, "").trim();
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token
  };
}

async function fetchAdmin(path: string) {
  const { apiBase, token } = getConfig();
  const res = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: token ? { authorization: `Bearer ${token}`, "x-admin-token": token } : {}
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

function fmtMoney(p: any) {
  const cents = Number(p);
  if (!Number.isFinite(cents)) return "—";
  const pesos = Math.trunc(cents / 100);
  return `$${pesos.toLocaleString("es-CO")}`;
}

export default async function ProductsPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Productos y Servicios</h1>
        <p>Configura `API_ADMIN_TOKEN` (o `ADMIN_API_TOKEN`) en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const created = typeof searchParams?.created === "string" ? searchParams.created : "";
  const error = typeof searchParams?.error === "string" ? searchParams.error : "";

  const products = await fetchAdmin("/admin/products");

  const productItems = (products.json?.items ?? []) as any[];

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Guardado.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <h3>Productos y Servicios</h3>
          </div>
          <div className="field-hint">Aquí se crean planes y suscripciones (sin contacto) y se amarra el producto/servicio.</div>
        </div>

        <div className="settings-group-body">
          <div style={{ display: "grid", gap: 14 }}>
            <NewPlanOrSubscriptionForm action={createPlanTemplate} catalogItems={productItems} />

            <div className="panel module" style={{ padding: 0 }}>
              <table className="table" aria-label="Tabla de productos y servicios">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Nombre</th>
                    <th>Tipo</th>
                    <th>Precio</th>
                    <th>IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {productItems.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>{p.sku}</td>
                      <td>{p.name}</td>
                      <td>{p.kind === "SERVICE" ? "Servicio" : "Producto"}</td>
                      <td>{fmtMoney(p.basePriceInCents)}</td>
                      <td>{p.taxPercent ? `${p.taxPercent}%` : "—"}</td>
                    </tr>
                  ))}
                  {productItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: "var(--muted)" }}>
                        Sin productos/servicios.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}
