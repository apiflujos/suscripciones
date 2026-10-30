import { PaginationBar } from "../PaginationBar";
import Link from "next/link";
import { listCustomers } from "../admin/_services/customers";
import { listSubscriptions } from "../admin/_services/subscriptions";
import { listTenants } from "../admin/_services/tenants";
import { resolveTenantId } from "../admin/_services/tenantResolver";
import { resolveSmartViewIds, parseFiltersParam, getSmartViewFields } from "@suscripciones/core/services/smartViews";
import { customerErrorText } from "./errors";
import { CustomersList } from "./CustomersList";
import { withReturnTo } from "../lib/returnTo";
import { ListCsvActions } from "../ui/ListCsvActions";
import { ViewModeToggles } from "../ui/ViewModeToggles";
import { FilterButton } from "../ui/FilterButton";
import { PageToolbar } from "../ui/PageToolbar";
import "./page-header.css";

export const dynamic = "force-dynamic";

function normalizeSku(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

function formatSubscriptionPlanName(plan: any) {
  const md = (plan?.metadata as any) || {};
  const displayName = String(md?.displayName || "").trim();
  const rawName = String(plan?.name || "").trim();
  const cleanName = rawName.replace(/^\s*\[\d+\]\s*/, "").trim();
  const name = displayName || cleanName || "—";
  const sku = normalizeSku(md?.sku);
  return sku ? `SKU ${sku} · ${name}` : name;
}

async function fetchCustomers(opts?: { q?: string; take?: number; page?: number; tenantId?: string; ids?: string[] }) {
  const q = String(opts?.q || "").trim();
  const take = Number(opts?.take ?? 10);
  const page = Number(opts?.page ?? 1);
  const tenantId = String(opts?.tenantId || "").trim();
  const ids = Array.isArray(opts?.ids) ? opts?.ids : [];
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * Math.min(Math.trunc(take), 500) : 0;
  return listCustomers({ q, take, skip, tenantId: tenantId || null, ids });
}


async function fetchCustomerSubscriptions(tenantId?: string) {
  const res = await listSubscriptions({ tenantId: tenantId || null, take: 300 });
  const items = Array.isArray(res.items) ? res.items : [];
  const map: Record<
    string,
    { hasPlan: boolean; productName?: string; status?: string; collectionMode?: string; subscriptionId?: string; productId?: string; planId?: string }
  > = {};
  for (const item of items) {
    const customerId = String(item?.customerId || item?.customer?.id || "");
    if (!customerId) continue;
    const status = String(item?.status || "");
    if (!status || status === "CANCELED") continue;
    if (map[customerId]) continue;
    const productName = String(item?.productName || "").trim() || formatSubscriptionPlanName(item?.plan);
    const collectionMode = String(item?.plan?.metadata?.collectionMode || "");
    const productId = String(item?.productId || item?.plan?.catalogProductId || item?.plan?.metadata?.catalog?.itemId || "");
    map[customerId] = { hasPlan: true, productName, status, collectionMode, subscriptionId: item?.id, productId, planId: item?.planId };
  }
  return map;
}

export default async function CustomersPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  // La lista es la vista predeterminada en todo el producto: muestra más por
  // pantalla y deja comparar filas. Las tarjetas se quedan como opción, no como
  // punto de partida.
  const vistaRaw = typeof sp.vista === "string" ? sp.vista : "lista";
  const vista = ["cards", "lista"].includes(vistaRaw) ? vistaRaw : "lista";
  const vistaTyped = vista as "cards" | "lista" | "kanban";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
  const resolvedTenantId = tenantId ? await resolveTenantId(tenantId) : null;
  const returnTo = `/customers?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(vista ? { vista } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;
  const take = 10;
  let resolvedIds: string[] = [];
  const usingSmartFilters = Boolean(viewId || filters);
  if (viewId) {
    resolvedIds = (await resolveSmartViewIds("customers", resolvedTenantId, null, viewId)) || [];
  } else if (filters) {
    const rules = parseFiltersParam(filters);
    if (rules) {
      resolvedIds = (await resolveSmartViewIds("customers", resolvedTenantId, null, undefined, rules)) || [];
    }
  }
  if (usingSmartFilters && resolvedIds.length === 0) {
    resolvedIds = ["__none__"];
  }

  const [data, tenantsRes, subscriptionsByCustomer] = await Promise.all([
    fetchCustomers({ q, take, page, tenantId: resolvedTenantId || "", ids: resolvedIds }),
    listTenants(),
    fetchCustomerSubscriptions(resolvedTenantId || "")
  ]);
  const items = (data.items ?? []) as any[];
  const total = Number.isFinite(Number((data as any)?.total)) ? Number((data as any).total) : items.length;
  const tenants = (tenantsRes ?? []) as Array<{ id: string; name: string }>;
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));

  const created = typeof sp.created === "string" ? sp.created : "";
  const updated = typeof sp.updated === "string" ? sp.updated : "";
  const deleted = typeof sp.deleted === "string" ? sp.deleted : "";
  const paymentSource = typeof sp.paymentSource === "string" ? sp.paymentSource : "";
  const paymentLink = typeof sp.paymentLink === "string" ? sp.paymentLink : "";
  const tokenRemoved = typeof sp.tokenRemoved === "string" ? sp.tokenRemoved : "";
  const sent = typeof sp.sent === "string" ? sp.sent : "";
  const sentMessage =
    sent === "link"
      ? "Link de pago enviado."
      : sent === "catalog"
        ? "Catálogo enviado."
        : sent === "token"
          ? "Link de débito automático enviado."
          : paymentLink
            ? "Link de pago enviado."
            : "";
  const error = customerErrorText(sp.error);

  const _customersPageHref = (p: number) => {
    const bp = {
      ...(q ? { q } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(vista ? { vista } : {}),
      ...(viewId ? { viewId } : {}),
      ...(filters ? { filters } : {})
    };
    return `/customers?${new URLSearchParams({ ...bp, page: String(p) })}`;
  };
  const renderPagination = (totalCount: number) => {
    const cp = Math.max(1, Number(page) || 1);
    const tp = Math.max(1, Math.ceil(totalCount / take));
    return <PaginationBar currentPage={cp} totalPages={tp} pageHref={_customersPageHref} />;
  };

  const currentPage = Math.max(1, Number(page) || 1);
  const startIndex = total > 0 ? (currentPage - 1) * take + 1 : 0;
  const endIndex = items.length ? Math.min(total, startIndex + items.length - 1) : 0;
  const summaryLabel =
    items.length > 0
      ? `Mostrando ${startIndex}-${endIndex} de ${total} · ${take} por página`
      : "Sin resultados";

  const exportHref = `/api/list-csv?${new URLSearchParams({
    scope: "customers",
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  }).toString()}`;

  return (
    <main className="page customersPage" style={{ maxWidth: "100%" }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Contacto creado.</div> : null}
      {updated ? <div className="card cardPad">Contacto actualizado.</div> : null}
      {deleted ? <div className="card cardPad">Contacto eliminado.</div> : null}
      {paymentSource ? <div className="card cardPad">Método de pago guardado.</div> : null}
      {tokenRemoved ? <div className="card cardPad">Método de pago removido.</div> : null}
      {sentMessage ? <div className="card cardPad">{sentMessage}</div> : null}

      <section className="settings-group">
        <PageToolbar
          className="compact"
          search={(
            <form action="/customers" method="GET" className="filtersForm filtersSearch">
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              {vista ? <input type="hidden" name="vista" value={vista} /> : null}
              {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
              {filters ? <input type="hidden" name="filters" value={filters} /> : null}
              <input
                className="input"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Buscar por nombre, email, teléfono o identificación..."
                aria-label="Buscar contactos"
                title="Busca por nombre, email, teléfono o identificación"
              />
              <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
            </form>
          )}
          searchActions={(
            <FilterButton
              scope="customers"
              baseParams={{
                ...(q ? { q } : {}),
                ...(tenantId ? { tenantId } : {}),
                ...(viewId ? { viewId } : {}),
                ...(filters ? { filters } : {})
              }}
              initialFields={getSmartViewFields("customers")}
            />
          )}
          views={(
            <ViewModeToggles
              currentMode={vistaTyped}
              baseParams={{
                ...(q ? { q } : {}),
                ...(tenantId ? { tenantId } : {}),
                ...(viewId ? { viewId } : {}),
                ...(filters ? { filters } : {})
              }}
            />
          )}
          summary={(
            <>
              <span className="page-toolbar-count">{items.length} contactos</span>
              <ListCsvActions exportHref={exportHref} tenantId={tenantId} defaultEntity="customers" />
            </>
          )}
          actions={(
            <div className="page-toolbar-actions-inner">
              <Link
                className="primary btn-compact btn-contact"
                href={withReturnTo("/customers/new", returnTo)}
                title="Crea un nuevo contacto con datos básicos y canal"
              >
                Crear contacto
              </Link>
            </div>
          )}
        />

        <div className="settings-group-body">

          <CustomersList
            items={items.map((c) => ({ ...c, tenantName: tenantById.get(String(c.tenantId || "")) || "—" }))}
            subscriptionsByCustomer={subscriptionsByCustomer}
            returnTo={returnTo}
            view={vista === "lista" ? "list" : "cards"}
          />

          {renderPagination(total)}
        </div>
      </section>
    </main>
  );
}
