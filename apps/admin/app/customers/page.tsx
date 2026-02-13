import { createCustomer } from "./actions";
import { NewCustomerForm } from "./NewCustomerForm";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";
import { CustomersTable } from "./CustomersTable";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchCustomers(opts?: { q?: string; take?: number; page?: number }) {
  const sp = new URLSearchParams();
  const q = String(opts?.q || "").trim();
  const take = Number(opts?.take ?? 200);
  const page = Number(opts?.page ?? 1);
  if (q) sp.set("q", q);
  if (Number.isFinite(take) && take > 0) sp.set("take", String(Math.min(Math.trunc(take), 500)));
  if (Number.isFinite(page) && page > 1) sp.set("skip", String((Math.trunc(page) - 1) * Math.min(Math.trunc(take), 500)));

  const path = sp.size ? `/admin/customers?${sp.toString()}` : "/admin/customers";
  const res = await fetchAdminCached(path, { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

async function fetchPaymentLinks(q: string) {
  const sp = new URLSearchParams();
  sp.set("take", "200");
  if (q.trim()) sp.set("q", q.trim());
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

export default async function CustomersPage({
  searchParams
}: {
  searchParams: { created?: string; updated?: string; deleted?: string; paymentSource?: string; paymentLink?: string; error?: string; q?: string };
}) {
  const { token } = getConfig();
  if (!token) return <main><h1 style={{ marginTop: 0 }}>Contactos</h1><p>Configura `ADMIN_API_TOKEN`.</p></main>;
  const q = typeof searchParams?.q === "string" ? searchParams.q : "";
  const page = typeof searchParams?.page === "string" ? Number(searchParams.page) : 1;
  const take = 200;
  const data = await fetchCustomers({ q, take, page });
  const items = (data.items ?? []) as any[];
  const latestLinks = await fetchPaymentLinks(q);
  const latestLinksObj = Object.fromEntries(latestLinks.entries());

  return (
    <main className="page" style={{ maxWidth: "100%" }}>
      {searchParams.error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {searchParams.error}
        </div>
      ) : null}
      {searchParams.created ? <div className="card cardPad">Contacto creado.</div> : null}
      {searchParams.updated ? <div className="card cardPad">Contacto actualizado.</div> : null}
      {searchParams.deleted ? <div className="card cardPad">Contacto eliminado.</div> : null}
      {searchParams.paymentSource ? <div className="card cardPad">Método de pago guardado.</div> : null}
      {searchParams.paymentLink ? <div className="card cardPad">Link de pago enviado.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Contactos</h3>
              <HelpTip text="Clientes y datos de contacto (email / teléfono). También permite guardar método de pago para cobros automáticos." />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <form action="/customers" method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="input" name="q" defaultValue={q} placeholder="Buscar..." aria-label="Buscar contactos" />
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

          <CustomersTable items={items} latestLinks={latestLinksObj} />

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <a
              className="ghost"
              href={`/customers?${new URLSearchParams({ ...(q ? { q } : {}), page: String(Math.max(1, (Number(page) || 1) - 1)) })}`}
              aria-disabled={Number(page) <= 1}
            >
              Anterior
            </a>
            <a
              className="ghost"
              href={`/customers?${new URLSearchParams({ ...(q ? { q } : {}), page: String((Number(page) || 1) + 1) })}`}
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
