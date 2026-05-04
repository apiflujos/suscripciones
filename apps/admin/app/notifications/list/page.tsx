import { LocalDateTime } from "../../ui/LocalDateTime";
import { listChatwootMessages } from "../../admin/_services/logs";
import { PageToolbar } from "../../ui/PageToolbar";
import { ListCsvActions } from "../../ui/ListCsvActions";
import { FiltersFocusButton } from "../../ui/FiltersFocusButton";
import { LogsFiltersAutoSubmit } from "../../logs/LogsFiltersAutoSubmit";
import { ViewModeToggles } from "../../ui/ViewModeToggles";

function renderContactBlock(item: any) {
  const name =
    item?.customer?.name ||
    item?.customerName ||
    item?.customer?.fullName ||
    item?.customer?.full_name ||
    "Cliente sin nombre";
  const email = item?.customer?.email || item?.customerEmail || "";
  const phone = item?.customer?.phone || item?.customerPhone || "";
  const fallbackId = item?.customerId ? `ID ${String(item.customerId).slice(0, 8)}` : "";
  const meta = [email, phone, fallbackId].filter(Boolean).join(" · ");
  const title = [name, email, phone].filter(Boolean).join(" · ");
  return (
    <div className="log-contact" title={title || "—"}>
      <span className="log-contact-name">{name || "Cliente sin nombre"}</span>
      {meta ? <span className="log-contact-meta muted">{meta}</span> : null}
    </div>
  );
}

function humanType(item: any) {
  const trigger = String(item?.providerResp?.meta?.trigger || "").trim().toUpperCase();
  const paymentType = String(item?.providerResp?.meta?.paymentType || "").trim().toUpperCase();
  const offsetSeconds = Number(item?.providerResp?.meta?.offsetSeconds ?? 0);
  if (trigger === "PAYMENT_LINK_CREATED" && paymentType === "LINK") return "Link de cobro enviado (pago puntual)";
  if (trigger === "PAYMENT_LINK_CREATED" && paymentType === "SUBSCRIPTION") return "Link de cobro enviado (suscripción por link)";
  if (trigger === "TOKENIZATION_LINK_CREATED") return "Link de tokenización enviado (débito automático)";
  if (trigger === "CATALOG_LINK_CREATED" && paymentType === "PLAN") return "Checkout de catálogo enviado (compra puntual)";
  if (trigger === "CATALOG_LINK_CREATED" && paymentType === "SUBSCRIPTION") return "Checkout de catálogo enviado (suscripción)";
  if (trigger === "PAYMENT_APPROVED") return "Pago aprobado";
  if (trigger === "PAYMENT_DECLINED" && paymentType === "LINK") return "Pago rechazado (pago puntual)";
  if (trigger === "PAYMENT_DECLINED" && paymentType === "SUBSCRIPTION") return "Pago rechazado (débito automático)";
  if (trigger === "SUBSCRIPTION_DUE" && paymentType === "LINK" && offsetSeconds <= 0) return "Recordatorio antes del vencimiento (pago puntual)";
  if (trigger === "SUBSCRIPTION_DUE" && paymentType === "SUBSCRIPTION" && offsetSeconds <= 0) return "Recordatorio antes del vencimiento (débito automático)";
  if (trigger === "SUBSCRIPTION_DUE" && paymentType === "LINK" && offsetSeconds > 0) return "Recordatorio en mora (pago puntual)";
  if (trigger === "SUBSCRIPTION_DUE" && paymentType === "SUBSCRIPTION" && offsetSeconds > 0) return "Recordatorio en mora (débito automático)";
  return "No clasificado";
}

function renderTrace(item: any) {
  const meta = item?.providerResp?.meta && typeof item.providerResp.meta === "object" ? item.providerResp.meta : {};
  const template = item?.providerResp?.template_params && typeof item.providerResp.template_params === "object" ? item.providerResp.template_params : {};
  const missingParams = Array.isArray(meta?.missingParams) ? meta.missingParams.filter(Boolean) : [];
  const parts = [
    meta?.trigger ? `evento: ${String(meta.trigger)}` : "",
    meta?.paymentType ? `flujo: ${String(meta.paymentType)}` : "",
    template?.name ? `plantilla: ${String(template.name)}` : "",
    meta?.ruleId ? `configuración: ${String(meta.ruleId)}` : "",
    missingParams.length ? `variables faltantes: ${missingParams.join(", ")}` : ""
  ].filter(Boolean);
  return parts.join(" · ");
}

export const dynamic = "force-dynamic";

export default async function WhatsappNotificationsListPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const type = typeof sp.type === "string" ? sp.type : "";
  const from = typeof sp.from === "string" ? sp.from : "";
  const to = typeof sp.to === "string" ? sp.to : "";
  const take = 20;
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const currentPage = Number.isFinite(page) && page > 0 ? Math.trunc(page) : 1;
  const skip = currentPage > 1 ? (currentPage - 1) * take : 0;
  const { items, total } = await listChatwootMessages({ take, skip, withCount: true, q, status, type, from, to });
  const countOnPage = items.length;
  const hasPrev = currentPage > 1;
  const hasNext = total != null ? currentPage * take < total : countOnPage >= take;
  const baseParams = {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  };
  const summaryText = total != null
    ? `Mostrando ${countOnPage ? `${skip + 1}-${skip + countOnPage} de ${total}` : "0"} · ${take} por página`
    : `Mostrando ${countOnPage || 0} · ${take} por página`;

  return (
    <main className="page notificationsPage">
      <LogsFiltersAutoSubmit />
      <section className="settings-group">
        <PageToolbar
          className="compact toolbar-search-left"
          search={(
            <form action="/notifications/list" method="GET" className="filtersForm filtersSearch" data-debounce-form="true">
              <input
                className="input"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Buscar cliente, email, teléfono o mensaje..."
                aria-label="Buscar notificaciones"
                title="Buscar por cliente, email, teléfono o mensaje"
              />
              <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
            </form>
          )}
          searchActions={<FiltersFocusButton />}
          actions={(
            <a className="ghost btn-compact" href="/notifications/list">Limpiar</a>
          )}
          filters={(
            <form action="/notifications/list" method="GET" className="filtersForm page-header-standard-filters-group" data-debounce-form="true">
              {q ? <input type="hidden" name="q" value={q} /> : null}
              <select className="select" name="status" defaultValue={status} style={{ minWidth: 140 }} data-auto-submit="true">
                <option value="">Estado: Todos</option>
                <option value="SENT">Enviado</option>
                <option value="PENDING">En cola</option>
                <option value="FAILED">Fallido</option>
              </select>
              <select className="select" name="type" defaultValue={type} style={{ minWidth: 220 }} data-auto-submit="true">
                <option value="">Tipo: Todos</option>
                <option value="PAYMENT_LINK_LINK">Link de cobro enviado (pago puntual)</option>
                <option value="PAYMENT_LINK_SUBSCRIPTION">Link de cobro enviado (suscripción por link)</option>
                <option value="TOKENIZATION_LINK">Link de tokenización enviado (débito automático)</option>
                <option value="CATALOG_LINK_PLAN">Checkout de catálogo enviado (compra puntual)</option>
                <option value="CATALOG_LINK_SUBSCRIPTION">Checkout de catálogo enviado (suscripción)</option>
                <option value="PAYMENT_APPROVED">Pago aprobado</option>
                <option value="PAYMENT_DECLINED_LINK">Pago rechazado (pago puntual)</option>
                <option value="PAYMENT_DECLINED_SUBSCRIPTION">Pago rechazado (débito automático)</option>
                <option value="EXPIRY_WARNING">Vencimiento y mora</option>
              </select>
              <input className="input" type="date" name="from" defaultValue={from} aria-label="Desde" title="Desde" style={{ width: 130 }} data-auto-submit="true" />
              <input className="input" type="date" name="to" defaultValue={to} aria-label="Hasta" title="Hasta" style={{ width: 130 }} data-auto-submit="true" />
            </form>
          )}
          smartViews={<div />}
          configHref="/settings?tab=notificaciones-whatsapp"
          summary={(
            <ListCsvActions
              exportHref={`/api/list-csv?${new URLSearchParams({ scope: "notifications", ...baseParams }).toString()}`}
              allowImport={false}
            />
          )}
        />

        <div className="settings-group-body">
          <div className="panel module" style={{ padding: 0 }}>
            <table className="table logs-table logs-table-messages" aria-label="Tabla de mensajes">
            <colgroup>
              <col style={{ width: "12%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "40%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Contacto</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m: any) => {
                const status = String(m.status || "");
                const chip =
                  status === "SENT"
                    ? { cls: "is-success", label: "Enviado" }
                    : status === "FAILED"
                      ? { cls: "is-error", label: "Fallido" }
                      : { cls: "is-warning", label: "En cola" };
                const trace = renderTrace(m);
                const detailRaw = String(m.errorMessage || trace || m.content || "—");
                const detailText = detailRaw.length > 200 ? `${detailRaw.slice(0, 200)}…` : detailRaw;
                return (
                  <tr key={m.id}>
                    <td className="log-date-cell"><LocalDateTime value={m.createdAt} variant="stacked" /></td>
                    <td className="log-contact-cell">{renderContactBlock(m)}</td>
                    <td className="log-type-cell" title={humanType(m)}>{humanType(m)}</td>
                    <td className="log-status-cell">
                      <span className={`status-chip ${chip.cls}`}>
                        <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                        {chip.label}
                      </span>
                    </td>
                    <td className="log-message-cell" title={detailRaw}>
                      <span className="log-message-text">{detailText}</span>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>
                    Sin mensajes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="pagination pagination-indicator" style={{ marginTop: 8 }}>
          <div className="pagination-summary">{summaryText}</div>
          {!hasPrev ? (
            <span className="page-link page-nav" aria-disabled="true">
              Anterior
            </span>
          ) : (
            <a
              className="page-link page-nav"
              href={`/notifications/list?${new URLSearchParams({
                ...baseParams,
                page: String(Math.max(1, currentPage - 1))
              })}`}
            >
              Anterior
            </a>
          )}
          {!hasNext ? (
            <span className="page-link page-nav" aria-disabled="true">
              Siguiente
            </span>
          ) : (
            <a
              className="page-link page-nav"
              href={`/notifications/list?${new URLSearchParams({
                ...baseParams,
                page: String(currentPage + 1)
              })}`}
            >
              Siguiente
            </a>
          )}
          </div>
        </div>
      </section>
    </main>
  );
}
