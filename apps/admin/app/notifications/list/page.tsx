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
          className="compact"
          search={(
            <form action="/notifications/list" method="GET" className="filtersForm filtersSearch" data-debounce-form="true">
              <input
                className="input"
                name="q"
                defaultValue={q}
                placeholder="Buscar contacto, teléfono o contenido..."
                aria-label="Buscar notificaciones"
                title="Buscar por contacto, teléfono o contenido"
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
                <option value="PENDING">Pendiente</option>
                <option value="FAILED">Fallido</option>
              </select>
              <select className="select" name="type" defaultValue={type} style={{ minWidth: 140 }} data-auto-submit="true">
                <option value="">Tipo: Todos</option>
                <option value="PAYMENT_LINK">Link de pago</option>
                <option value="PAYMENT_CONFIRMED">Pago confirmado</option>
                <option value="EXPIRY_WARNING">Vencimiento</option>
                <option value="PAYMENT_FAILED">Pago fallido</option>
              </select>
              <input className="input" type="date" name="from" defaultValue={from} aria-label="Desde" title="Desde" style={{ width: 130 }} data-auto-submit="true" />
              <input className="input" type="date" name="to" defaultValue={to} aria-label="Hasta" title="Hasta" style={{ width: 130 }} data-auto-submit="true" />
            </form>
          )}
          smartViews={<div />}
          configHref="http://localhost:3002/settings?tab=notificaciones-whatsapp"
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
                      : { cls: "is-warning", label: "Pendiente" };
                const detailRaw = String(m.errorMessage || m.content || "—");
                const detailText = detailRaw.length > 200 ? `${detailRaw.slice(0, 200)}…` : detailRaw;
                return (
                  <tr key={m.id}>
                    <td className="log-date-cell"><LocalDateTime value={m.createdAt} variant="stacked" /></td>
                    <td className="log-contact-cell">{renderContactBlock(m)}</td>
                    <td className="log-type-cell" title={m.type || "—"}>{m.type || "—"}</td>
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
          <a
            className="page-link page-nav"
            href={`/notifications/list?${new URLSearchParams({
              ...baseParams,
              page: String(Math.max(1, currentPage - 1))
            })}`}
            aria-disabled={!hasPrev}
          >
            Anterior
          </a>
          <a
            className="page-link page-nav"
            href={`/notifications/list?${new URLSearchParams({
              ...baseParams,
              page: String(currentPage + 1)
            })}`}
            aria-disabled={!hasNext}
          >
            Siguiente
          </a>
          </div>
        </div>
      </section>
    </main>
  );
}
