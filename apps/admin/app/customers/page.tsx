import { createCustomer } from "./actions";
import { CustomersModals } from "./CustomersModals";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { normalizeErrorParam } from "../lib/errorParam";
import { CustomersTable } from "./CustomersTable";
import { getCsrfToken } from "../lib/csrf";
import { createPlanAndSubscription } from "../billing/actions";
import { CustomersFilters } from "./CustomersFilters";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchCustomers(opts?: { q?: string; take?: number; page?: number; tenantId?: string }) {
  const sp = new URLSearchParams();
  const q = String(opts?.q || "").trim();
  const take = Number(opts?.take ?? 10);
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

async function fetchSmartLists() {
  const res = await fetchAdminCached("/admin/comms/smart-lists?take=200", { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

async function fetchSmartListMembers(id: string, opts: { take: number; page: number; tenantId?: string }) {
  if (!id) return { items: [] as any[] };
  const take = Number(opts.take || 10);
  const page = Number(opts.page || 1);
  const tenantId = String(opts.tenantId || "").trim();
  const skip = Math.max(0, Math.trunc(page) - 1) * Math.max(1, Math.trunc(take));
  const tenantParam = tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetchAdminCached(
    `/admin/comms/smart-lists/${encodeURIComponent(id)}/members?active=1&take=${encodeURIComponent(
      String(Math.min(take, 200))
    )}&skip=${encodeURIComponent(String(skip))}${tenantParam}`,
    { ttlMs: 1500 }
  );
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
  const map: Record<
    string,
    { hasPlan: boolean; planName?: string; status?: string; collectionMode?: string }
  > = {};
  for (const item of items) {
    const customerId = String(item?.customerId || item?.customer?.id || "");
    if (!customerId) continue;
    const status = String(item?.status || "");
    if (!status || status === "CANCELED") continue;
    if (map[customerId]) continue;
    const planName = String(item?.plan?.name || "");
    const collectionMode = String(item?.plan?.metadata?.collectionMode || "");
    map[customerId] = { hasPlan: true, planName, status, collectionMode };
  }
  return map;
}

async function fetchCartTemplates(tenantId?: string) {
  const sp = new URLSearchParams();
  if (tenantId) sp.set("tenantId", tenantId);
  const res = await fetchAdminCached(`/admin/checkout-templates?${sp.toString()}`, { ttlMs: 1500 });
  const data = res.json || { items: [] as any[] };
  const items = Array.isArray(data.items)
    ? (data.items as Array<{ id?: string; name?: string; kind?: string; active?: boolean }>)
    : [];
  return items
    .filter((t) => String(t?.kind || "") === "CART" && Boolean(t?.active))
    .map((t) => ({ id: String(t?.id || ""), name: String(t?.name || "") }))
    .filter((t) => t.id && t.name);
}

async function fetchProducts(tenantId?: string) {
  const sp = new URLSearchParams();
  sp.set("take", "300");
  if (tenantId) sp.set("tenantId", tenantId);
  const res = await fetchAdminCached(`/admin/products?${sp.toString()}`, { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

async function fetchCheckoutTemplates(tenantId?: string) {
  const sp = new URLSearchParams();
  if (tenantId) sp.set("tenantId", tenantId);
  else sp.set("tenantId", "all");
  const res = await fetchAdminCached(`/admin/checkout-templates?${sp.toString()}`, { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

async function fetchCustomerById(id: string) {
  if (!id) return null;
  const res = await fetchAdminCached(`/admin/customers/${encodeURIComponent(id)}`, { ttlMs: 1500 });
  if (!res?.ok) return null;
  return res.json?.customer || null;
}

export default async function CustomersPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) {
    return (
      <main className="page">
        <div className="card cardPad">Configura `ADMIN_API_TOKEN` para consultar contactos.</div>
      </main>
    );
  }
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const smartListId = typeof sp.list === "string" ? sp.list : "";
  const txCustomerId = typeof sp.tx === "string" ? sp.tx : "";
  const returnTo = `/customers?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(smartListId ? { list: smartListId } : {}),
    ...(txCustomerId ? { tx: txCustomerId } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;
  const take = 10;
  const [data, tenantsRes, txCustomer, productsRes, templatesRes, smartListsRes] = await Promise.all([
    smartListId ? fetchSmartListMembers(smartListId, { take, page, tenantId }) : fetchCustomers({ q, take, page, tenantId }),
    fetchAdminCached("/admin/tenants", { ttlMs: 1500 }),
    txCustomerId ? fetchCustomerById(txCustomerId) : Promise.resolve(null),
    fetchProducts(tenantId),
    fetchCheckoutTemplates(tenantId),
    fetchSmartLists()
  ]);
  const smartListItems = smartListId ? ((data as any)?.items ?? []) : [];
  const smartListCustomers = smartListId
    ? smartListItems.map((m: any) => m?.customer).filter(Boolean)
    : null;
  const items = (smartListCustomers ?? data.items ?? []) as any[];
  const total = Number.isFinite(Number((data as any)?.total)) ? Number((data as any).total) : items.length;
  if (txCustomer && !items.some((c) => String(c.id) === String(txCustomer.id))) {
    items.unshift(txCustomer);
  }
  const tenants = (tenantsRes.json?.items ?? []) as Array<{ id: string; name: string }>;
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));
  const [latestLinks, subscriptionsByCustomer, cartTemplates] = await Promise.all([
    fetchPaymentLinks(q, tenantId),
    fetchCustomerSubscriptions(tenantId),
    fetchCartTemplates(tenantId)
  ]);
  const latestLinksObj = Object.fromEntries(latestLinks.entries());

  const created = typeof sp.created === "string" ? sp.created : "";
  const updated = typeof sp.updated === "string" ? sp.updated : "";
  const deleted = typeof sp.deleted === "string" ? sp.deleted : "";
  const paymentSource = typeof sp.paymentSource === "string" ? sp.paymentSource : "";
  const paymentLink = typeof sp.paymentLink === "string" ? sp.paymentLink : "";
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : undefined);

  const renderPagination = (totalCount: number) => {
    const currentPage = Math.max(1, Number(page) || 1);
    const totalKnown = !smartListId;
    const hasNext = totalKnown ? totalCount > 0 && currentPage < Math.max(1, Math.ceil(totalCount / take)) : items.length >= take;
    const totalPages = totalKnown ? Math.max(1, Math.ceil(totalCount / take)) : currentPage + (hasNext ? 1 : 0);
    const desktopWindow = 10;
    let start = Math.max(1, currentPage - Math.floor(desktopWindow / 2));
    let end = start + desktopWindow - 1;
    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - (desktopWindow - 1));
    }
    const pages = [];
    for (let i = start; i <= end; i += 1) pages.push(i);
    const mobileWindow = 5;
    let mobileStart = Math.max(1, currentPage - 2);
    let mobileEnd = mobileStart + (mobileWindow - 1);
    if (mobileEnd > totalPages) {
      mobileEnd = totalPages;
      mobileStart = Math.max(1, mobileEnd - (mobileWindow - 1));
    }
    const baseParams = {
      ...(q ? { q } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(smartListId ? { list: smartListId } : {})
    };
    return (
      <div className="pagination pagination-indicator">
        <a
          className="page-link page-nav"
          href={`/customers?${new URLSearchParams({
            ...baseParams,
            page: String(Math.max(1, currentPage - 1))
          })}`}
          aria-disabled={currentPage <= 1}
        >
          Anterior
        </a>
        <div className="pagination-pages">
          {pages.map((p) => {
            const isDesktopOnly = p < mobileStart || p > mobileEnd;
            return (
              <a
                key={`customers-page-${p}`}
                className={`page-link ${p === currentPage ? "is-active" : ""} ${isDesktopOnly ? "page-desktop-only" : ""}`}
                href={`/customers?${new URLSearchParams({ ...baseParams, page: String(p) })}`}
                aria-current={p === currentPage ? "page" : undefined}
              >
                {p}
              </a>
            );
          })}
        </div>
        <a
          className="page-link page-nav"
          href={`/customers?${new URLSearchParams({
            ...baseParams,
            page: String(currentPage + 1)
          })}`}
          aria-disabled={!hasNext}
        >
          Siguiente
        </a>
      </div>
    );
  };

  const currentPage = Math.max(1, Number(page) || 1);
  const startIndex = total > 0 ? (currentPage - 1) * take + 1 : 0;
  const endIndex = items.length ? Math.min(total, startIndex + items.length - 1) : 0;
  const smartListName = smartListsRes.json?.items?.find((list: any) => String(list.id) === String(smartListId))?.name || "";
  const summaryLabel =
    items.length > 0
      ? smartListId
        ? `Mostrando ${startIndex}-${endIndex} · Lista inteligente: ${smartListName || "Seleccionada"}`
        : `Mostrando ${startIndex}-${endIndex} de ${total} · ${take} por página`
      : smartListId
        ? `Sin resultados en la lista inteligente ${smartListName || ""}`
        : "Sin resultados";

  return (
    <main className="page" style={{ maxWidth: "100%" }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Contacto creado.</div> : null}
      {updated ? <div className="card cardPad">Contacto actualizado.</div> : null}
      {deleted ? <div className="card cardPad">Contacto eliminado.</div> : null}
      {paymentSource ? <div className="card cardPad">Método de pago guardado.</div> : null}
      {paymentLink ? <div className="card cardPad">Link de pago enviado.</div> : null}
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="contacts-toolbar">
            <div className="contacts-toolbar-summary">{summaryLabel}</div>
            <CustomersModals
              customers={items}
              products={productsRes?.items ?? []}
              checkoutTemplates={templatesRes?.items ?? []}
              csrfToken={csrfToken}
              tenants={tenants}
              tenantId={tenantId}
              createCustomer={createCustomer}
              createPlanAndSubscription={createPlanAndSubscription}
              returnTo={returnTo}
              actionsClassName="contacts-toolbar-actions"
            />
          </div>
          <div className="filtersRow">
            <div className="filtersLeft">
              <div className="filtersPanel">
            <CustomersFilters
              q={q}
              tenantId={tenantId}
              tenants={tenants}
              smartLists={(smartListsRes.json?.items ?? []) as Array<{ id: string; name: string }>}
              smartListId={smartListId}
            />
              </div>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          {renderPagination(total)}

          <CustomersTable
            items={items.map((c) => ({ ...c, tenantName: tenantById.get(String(c.tenantId || "")) || "—" }))}
            latestLinks={latestLinksObj}
            subscriptionsByCustomer={subscriptionsByCustomer}
            cartTemplates={cartTemplates}
            products={productsRes?.items ?? []}
            checkoutTemplates={templatesRes?.items ?? []}
            tenants={tenants}
            createCustomer={createCustomer}
            createPlanAndSubscription={createPlanAndSubscription}
            csrfToken={csrfToken}
            returnTo={returnTo}
            initialTxCustomerId={txCustomerId}
          />

          {renderPagination(total)}
        </div>
      </section>
    </main>
  );
}
