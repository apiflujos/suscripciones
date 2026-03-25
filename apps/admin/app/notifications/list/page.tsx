import { LocalDateTime } from "../../ui/LocalDateTime";
import { listChatwootMessages } from "../../admin/_services/logs";

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
  searchParams?: Promise<{ page?: string; q?: string; status?: string; type?: string; from?: string; to?: string }>;
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
    <main className="page">
      <div className="panelHeaderRow" style={{ justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h3 style={{ margin: 0 }}>Notificaciones WhatsApp</h3>
          <div className="muted" style={{ fontSize: 12 }}>Lista de mensajes enviados y su estado.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <a className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp">
            Configurar WhatsApp
          </a>
          {typeof total === "number" ? <span className="pill">Total {total}</span> : null}
        </div>
      </div>

      <div className="filtersRow" style={{ marginTop: 12 }}>
        <div className="filtersLeft">
          <div className="filtersTop">
            <div className="filtersNote">
              Filtra por fecha, estado, tipo y texto.
            </div>
            <div className="filtersSummary">{summaryText}</div>
          </div>
          <div className="filtersPanel">
            <form action="/notifications/list" method="GET" className="filtersForm filtersSearch" data-debounce-form="true">
              <input
                className="input"
                name="q"
                defaultValue={q}
                placeholder="Buscar contacto, teléfono o contenido..."
                aria-label="Buscar notificaciones"
                title="Buscar por contacto, teléfono o contenido"
              />
              <select className="select" name="status" defaultValue={status}>
                <option value="">Estado: Todos</option>
                <option value="SENT">Estado: Enviado</option>
                <option value="PENDING">Estado: Pendiente</option>
                <option value="FAILED">Estado: Fallido</option>
              </select>
              <select className="select" name="type" defaultValue={type}>
                <option value="">Tipo: Todos</option>
                <option value="PAYMENT_LINK">Tipo: Link de pago</option>
                <option value="PAYMENT_CONFIRMED">Tipo: Pago confirmado</option>
                <option value="EXPIRY_WARNING">Tipo: Vencimiento</option>
                <option value="PAYMENT_FAILED">Tipo: Pago fallido</option>
              </select>
              <input className="input" type="date" name="from" defaultValue={from} aria-label="Desde" title="Desde" />
              <input className="input" type="date" name="to" defaultValue={to} aria-label="Hasta" title="Hasta" />
              <button className="ghost btn-compact" type="submit">Filtrar</button>
              <a className="ghost btn-compact" href="/notifications/list">Limpiar</a>
            </form>
          </div>
        </div>
      </div>

      <div className="settings-group-body" style={{ marginTop: 12 }}>
        <div className="pagination pagination-indicator" style={{ marginBottom: 12 }}>
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

        <div className="panel module" style={{ padding: 0 }}>
          <table className="table logs-table logs-table-messages" aria-label="Tabla de mensajes">
            <colgroup>
              <col style={{ width: "8%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "52%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Contacto</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Detalle</th>
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
                const detailText = detailRaw.length > 300 ? `${detailRaw.slice(0, 300)}…` : detailRaw;
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
      </div>
    </main>
  );
}
