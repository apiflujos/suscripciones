import { createProduct, deleteProduct } from "./actions";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { ProductsTable } from "./ProductsTable";
import { getCsrfToken } from "../lib/csrf";
import { createTenant } from "../tenants/actions";
import { ProductsModals } from "./ProductsModals";
import { createCustomerFromBilling, createPlanAndSubscription } from "../billing/actions";

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
      <main className="page pageWide">
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
  const take = 20;
  sp.set("take", String(take));
  if (Number.isFinite(page) && page > 1) sp.set("skip", String((Math.trunc(page) - 1) * take));
  const [products, tenantsRes, customersRes, templatesRes] = await Promise.all([
    fetchAdmin(`/admin/products?${sp.toString()}`),
    fetchAdminCached("/admin/tenants", { ttlMs: 1500 }),
    fetchAdminCached(tenantId ? `/admin/customers?take=200&tenantId=${encodeURIComponent(tenantId)}` : "/admin/customers?take=200", { ttlMs: 1500 }),
    fetchAdminCached(tenantId ? `/admin/checkout-templates?tenantId=${encodeURIComponent(tenantId)}` : "/admin/checkout-templates", { ttlMs: 1500 })
  ]);

  const productItems = (products.json?.items ?? []) as any[];
  const tenants = (tenantsRes.json?.items ?? []) as Array<{ id: string; name: string }>;
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));

  return (
    <main className="page pageWide">
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
          <div className="filtersRow">
            <div className="filtersLeft">
              <div className="filtersNote">Gestiona productos y servicios y asócialos a contactos para crear planes o suscripciones.</div>
              <div className="filtersPanel">
                <form action="/products" method="GET" className="filtersForm">
                  {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                  <input className="input" name="q" defaultValue={q} placeholder="Buscar..." aria-label="Buscar productos" />
                  <button className="ghost" type="submit">
                    Buscar
                  </button>
                </form>
                <form action="/products" method="GET" className="filtersForm">
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
                <form action={createTenant} className="filtersForm">
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="returnTo" value={`/products${tenantId || q ? `?${new URLSearchParams({ ...(tenantId ? { tenantId } : {}), ...(q ? { q } : {}) }).toString()}` : ""}`} />
                  <input className="input" name="name" placeholder="Nuevo canal" />
                  <button className="ghost" type="submit">Crear canal</button>
                </form>
              </div>
            </div>
            <div className="filtersRight">
              <span className="pill">{productItems.length} resultados</span>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          <div style={{ display: "grid", gap: 14 }}>
            <ProductsModals
              customers={customersRes.json?.items ?? []}
              products={productItems}
              checkoutTemplates={templatesRes.json?.items ?? []}
              csrfToken={csrfToken}
              tenants={tenants}
              tenantId={tenantId}
              createProduct={createProduct}
              createCustomer={createCustomerFromBilling}
              createPlanAndSubscription={createPlanAndSubscription}
              returnTo={returnTo}
            />

            <ProductsTable
              items={productItems.map((p) => {
                const ids = Array.isArray(p.tenantIds) && p.tenantIds.length ? p.tenantIds : [p.tenantId].filter(Boolean);
                const names = ids.map((id: string) => tenantById.get(String(id))).filter(Boolean) as string[];
                return {
                  ...p,
                  currency: String(p.currency || "COP"),
                  tenantId: tenantId || ids[0] || "",
                  tenantName: names.length ? names.join(", ") : "—",
                  tenantIds: ids
                };
              })}
              csrfToken={csrfToken}
              deleteProductAction={deleteProduct}
              tenants={tenants}
              customers={customersRes.json?.items ?? []}
              checkoutTemplates={templatesRes.json?.items ?? []}
              createCustomer={createCustomerFromBilling}
              createPlanAndSubscription={createPlanAndSubscription}
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
