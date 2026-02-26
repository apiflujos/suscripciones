import { createCustomer } from "./actions";
import { NewCustomerForm } from "./NewCustomerForm";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";
import { CustomersTable } from "./CustomersTable";
import { getCsrfToken } from "../lib/csrf";
import { createTenant } from "../tenants/actions";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchCustomers(opts?: { q?: string; take?: number; page?: number; tenantId?: string }) {
  const sp = new URLSearchParams();
  const q = String(opts?.q || "").trim();
  const take = Number(opts?.take ?? 200);
  const page = Number(opts?.page ?? 1);
  const tenantId = String(opts?.tenantId || "").trim();
  if (q) sp.set("q", q);
  if (tenantId) sp.set("tenantId", tenantId);
  if (Number.isFinite(take) && take > 0) sp.set("take", String(Math.min(Math.trunc(take), 500)));
  if (Number.isFinite(page) && page > 1) sp.set("skip", String((Math.trunc(page) - 1) * Math.min(Math.trunc(take), 500)));

  const path = sp.size ? `/admin/customers?${sp.toString()}` : "/admin/customers";
  const res = await fetchAdminCached(path, { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

async function fetchPaymentLinks(q: string, tenantId?: string) {
  const sp = new URLSearchParams();
  sp.set("take", "200");
  if (q.trim()) sp.set("q", q.trim());
  if (tenantId) sp.set("tenantId", tenantId);
  const res = await fetchAdminCached(`/admin/orders?${sp.toString()}`, { ttlMs: 1500 });
  const data = res.json || { items: [] as any[] };
  const items = Array.isArray(data.items) ? data.items : [];
  const latestByCustomer = new Map<string, { checkoutUrl: string; createdAt: string; chatwootStatus: string; chatwootError?: string }>();
  for (const item of items) {
    const customerId = String(item?.customer?.id || item?.customerId || "");
    const checkoutUrl = String(item?.checkoutUrl || "");
    const createdAt = String(item?.createdAt || "");
    const chatwootStatus = String(item?.chatwootMsgs?.[0]?.status || "");
    const chatwootError = String(item?.chatwootMsgs?.[0]?.errorMessage || "");
    if (!customerId || !checkoutUrl) continue;
    const prev = latestByCustomer.get(customerId);
    if (!prev || (createdAt && createdAt > prev.createdAt)) {
      latestByCustomer.set(customerId, { checkoutUrl, createdAt, chatwootStatus, chatwootError: chatwootError || undefined });
    }
  }
  return latestByCustomer;
}

async function fetchCustomerSubscriptions(tenantId?: string) {
  const sp = new URLSearchParams();
  sp.set("take", "300");
  if (tenantId) sp.set("tenantId", tenantId);
  const res = await fetchAdminCached(`/admin/subscriptions?${sp.toString()}`, { ttlMs: 1500 });
  const data = res.json || { items: [] as any[] };
  const items = Array.isArray(data.items) ? data.items : [];
  const map: Record<string, { hasPlan: boolean }> = {};
  for (const item of items) {
    const customerId = String(item?.customerId || item?.customer?.id || "");
    if (!customerId) continue;
    const status = String(item?.status || "");
    if (status && status !== "CANCELED") {
      map[customerId] = { hasPlan: true };
    }
  }
  return map;
}

export default async function CustomersPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) return <main><h1 style={{ marginTop: 0 }}>Contactos</h1><p>Configura `ADMIN_API_TOKEN`.</p></main>;
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const returnTo = `/customers?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;
  const tenantCreated = typeof sp.tenantCreated === "string" ? sp.tenantCreated : "";
  const take = 200;
  const [data, tenantsRes] = await Promise.all([
    fetchCustomers({ q, take, page, tenantId }),
    fetchAdminCached("/admin/tenants", { ttlMs: 1500 })
  ]);
  const items = (data.items ?? []) as any[];
  const tenants = (tenantsRes.json?.items ?? []) as Array<{ id: string; name: string }>;
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));
  const [latestLinks, subscriptionsByCustomer] = await Promise.all([
    fetchPaymentLinks(q, tenantId),
    fetchCustomerSubscriptions(tenantId)
  ]);
  const latestLinksObj = Object.fromEntries(latestLinks.entries());

  return (
    <main className="page" style={{ maxWidth: "100%" }}>
      {sp.error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {sp.error}
        </div>
      ) : null}
      {sp.created ? <div className="card cardPad">Contacto creado.</div> : null}
      {sp.updated ? <div className="card cardPad">Contacto actualizado.</div> : null}
      {sp.deleted ? <div className="card cardPad">Contacto eliminado.</div> : null}
      {sp.paymentSource ? <div className="card cardPad">Método de pago guardado.</div> : null}
      {sp.paymentLink ? <div className="card cardPad">Link de pago enviado.</div> : null}
      {tenantCreated ? <div className="card cardPad">Canal creado.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Contactos</h3>
              <HelpTip text="Clientes y datos de contacto (email / teléfono). También permite guardar método de pago para cobros automáticos." />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <form action="/customers" method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                <input className="input" name="q" defaultValue={q} placeholder="Buscar..." aria-label="Buscar contactos" />
                <button className="ghost" type="submit">
                  Buscar
                </button>
              </form>
              <form action="/customers" method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                <input type="hidden" name="returnTo" value={`/customers${tenantId || q ? `?${new URLSearchParams({ ...(tenantId ? { tenantId } : {}), ...(q ? { q } : {}) }).toString()}` : ""}`} />
                <input className="input" name="name" placeholder="Nuevo canal" />
                <button className="ghost" type="submit">Crear canal</button>
              </form>
              <span className="pill">{items.length} resultados</span>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          <NewCustomerForm createCustomer={createCustomer} csrfToken={csrfToken} tenantId={tenantId} tenants={tenants} returnTo={returnTo} />

          <CustomersTable
            items={items.map((c) => ({ ...c, tenantName: tenantById.get(String(c.tenantId || "")) || "—" }))}
            latestLinks={latestLinksObj}
            subscriptionsByCustomer={subscriptionsByCustomer}
            csrfToken={csrfToken}
            returnTo={returnTo}
          />

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <a
              className="ghost"
              href={`/customers?${new URLSearchParams({
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
              href={`/customers?${new URLSearchParams({
                ...(q ? { q } : {}),
                ...(tenantId ? { tenantId } : {}),
                page: String((Number(page) || 1) + 1)
              })}`}
              aria-disabled={items.length < take}
            >
              Siguiente
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
