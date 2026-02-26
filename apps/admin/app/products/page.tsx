import { createPlanTemplate, createProduct, deleteProduct } from "./actions";
import { NewPlanOrSubscriptionForm } from "./NewPlanOrSubscriptionForm";
import { NewProductForm } from "./NewProductForm";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";
import { ProductsTable } from "./ProductsTable";
import { getCsrfToken } from "../lib/csrf";
import { createTenant } from "../tenants/actions";

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
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Productos y Servicios</h1>
        <p>Configura `ADMIN_API_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const spParams = (await searchParams) ?? {};
  const created = typeof spParams.created === "string" ? spParams.created : "";
  const updated = typeof spParams.updated === "string" ? spParams.updated : "";
  const deleted = typeof spParams.deleted === "string" ? spParams.deleted : "";
  const tenantId = typeof spParams.tenantId === "string" ? spParams.tenantId : "";
  const tenantCreated = typeof spParams.tenantCreated === "string" ? spParams.tenantCreated : "";
  const error = typeof spParams.error === "string" ? spParams.error : "";
  const q = typeof spParams.q === "string" ? spParams.q : "";
  const page = typeof spParams.page === "string" ? Number(spParams.page) : 1;
  const returnTo = `/products?${new URLSearchParams({
    ...(tenantId ? { tenantId } : {}),
    ...(q ? { q } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;

  const sp = new URLSearchParams();
  if (tenantId) sp.set("tenantId", tenantId);
  if (q.trim()) sp.set("q", q.trim());
  const take = 200;
  sp.set("take", String(take));
  if (Number.isFinite(page) && page > 1) sp.set("skip", String((Math.trunc(page) - 1) * take));
  const [products, tenantsRes] = await Promise.all([
    fetchAdmin(`/admin/products?${sp.toString()}`),
    fetchAdminCached("/admin/tenants", { ttlMs: 1500 })
  ]);

  const productItems = (products.json?.items ?? []) as any[];
  const tenants = (tenantsRes.json?.items ?? []) as Array<{ id: string; name: string }>;
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Guardado.</div> : null}
      {updated ? <div className="card cardPad">Actualizado.</div> : null}
      {deleted ? <div className="card cardPad">Eliminado.</div> : null}
      {tenantCreated ? <div className="card cardPad">Canal creado.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Productos y Servicios</h3>
              <HelpTip text="Aquí se crean planes y suscripciones (sin contacto) y se amarra el producto/servicio." />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <form action="/products" method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                <input className="input" name="q" defaultValue={q} placeholder="Buscar..." aria-label="Buscar productos" />
                <button className="ghost" type="submit">
                  Buscar
                </button>
              </form>
              <form action="/products" method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {q ? <input type="hidden" name="q" value={q} /> : null}
                <select className="select" name="tenantId" defaultValue={tenantId}>
                  <option value="">Canal: (todos)</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button className="ghost" type="submit">Aplicar</button>
              </form>
              <form action={createTenant} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="returnTo" value={`/products${tenantId || q ? `?${new URLSearchParams({ ...(tenantId ? { tenantId } : {}), ...(q ? { q } : {}) }).toString()}` : ""}`} />
                <input className="input" name="name" placeholder="Nuevo canal" />
                <button className="ghost" type="submit">Crear canal</button>
              </form>
              <span className="pill">{productItems.length} resultados</span>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gap: 14 }}>
              <NewProductForm action={createProduct} csrfToken={csrfToken} tenantId={tenantId} tenants={tenants} returnTo={returnTo} />
              <NewPlanOrSubscriptionForm action={createPlanTemplate} catalogItems={productItems} csrfToken={csrfToken} tenantId={tenantId} tenants={tenants} />
            </div>

            <ProductsTable
              items={productItems.map((p) => {
                const ids = Array.isArray(p.tenantIds) && p.tenantIds.length ? p.tenantIds : [p.tenantId].filter(Boolean);
                const names = ids.map((id: string) => tenantById.get(String(id))).filter(Boolean) as string[];
                return {
                  ...p,
                  tenantId: tenantId || ids[0] || "",
                  tenantName: names.length ? names.join(", ") : "—",
                  tenantIds: ids
                };
              })}
              csrfToken={csrfToken}
              deleteProductAction={deleteProduct}
              tenants={tenants}
              returnTo={returnTo}
            />

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <a
                className="ghost"
                href={`/products?${new URLSearchParams({
                  ...(q ? { q } : {}),
                  ...(tenantId ? { tenantId } : {}),
                  page: String(Math.max(1, (Number(page) || 1) - 1))
                })}`}
                aria-disabled={Number(page) <= 1}
              >
                Anterior
              </a>
              <a
                className="ghost"
                href={`/products?${new URLSearchParams({
                  ...(q ? { q } : {}),
                  ...(tenantId ? { tenantId } : {}),
                  page: String((Number(page) || 1) + 1)
                })}`}
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
