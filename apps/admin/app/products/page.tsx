import { createPlanTemplate } from "./actions";
import { NewPlanOrSubscriptionForm } from "./NewPlanOrSubscriptionForm";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";
import { ProductsTable } from "./ProductsTable";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchAdmin(path: string) {
  return fetchAdminCached(path, { ttlMs: 1500 });
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
        <p>Configura `ADMIN_API_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const created = typeof searchParams?.created === "string" ? searchParams.created : "";
  const updated = typeof searchParams?.updated === "string" ? searchParams.updated : "";
  const error = typeof searchParams?.error === "string" ? searchParams.error : "";
  const q = typeof searchParams?.q === "string" ? searchParams.q : "";
  const page = typeof searchParams?.page === "string" ? Number(searchParams.page) : 1;

  const sp = new URLSearchParams();
  if (q.trim()) sp.set("q", q.trim());
  const take = 200;
  sp.set("take", String(take));
  if (Number.isFinite(page) && page > 1) sp.set("skip", String((Math.trunc(page) - 1) * take));
  const products = await fetchAdmin(`/admin/products?${sp.toString()}`);

  const productItems = (products.json?.items ?? []) as any[];

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Guardado.</div> : null}
      {updated ? <div className="card cardPad">Actualizado.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Productos y Servicios</h3>
              <HelpTip text="Aquí se crean planes y suscripciones (sin contacto) y se amarra el producto/servicio." />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <form action="/products" method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="input" name="q" defaultValue={q} placeholder="Buscar..." aria-label="Buscar productos" />
                <button className="ghost" type="submit">
                  Buscar
                </button>
              </form>
              <span className="pill">{productItems.length} resultados</span>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          <div style={{ display: "grid", gap: 14 }}>
            <NewPlanOrSubscriptionForm action={createPlanTemplate} catalogItems={productItems} />

            <ProductsTable items={productItems} />

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <a
                className="ghost"
                href={`/products?${new URLSearchParams({ ...(q ? { q } : {}), page: String(Math.max(1, (Number(page) || 1) - 1)) })}`}
                aria-disabled={Number(page) <= 1}
              >
                Anterior
              </a>
              <a
                className="ghost"
                href={`/products?${new URLSearchParams({ ...(q ? { q } : {}), page: String((Number(page) || 1) + 1) })}`}
                aria-disabled={productItems.length < take}
              >
                Siguiente
              </a>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}
