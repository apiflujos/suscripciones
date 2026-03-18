import Link from "next/link";
import { listSmartListMembers, getSmartListById } from "../../admin/_services/smartLists";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";

async function fetchMembers(id: string, tenantId: string | null, page = 1) {
  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  return listSmartListMembers({ id, tenantId, active: true, take, skip });
}

export default async function SmartListDetail({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const take = 20;
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const listRes = await getSmartListById({ id, tenantId: session?.tenantId || null });
  const list = listRes.ok ? (listRes.smartList as any) : null;

  const membersRes = await fetchMembers(id, session?.tenantId || null, page);
  const items: any[] = membersRes.ok ? (membersRes.items || []) : [];
  const total = membersRes.ok ? Number(membersRes.total ?? items.length) : items.length;

  if (!list) {
    return (
      <div className="page">
        <div className="panel module">
          <div className="pageTitle">Lista no encontrada</div>
          <div className="pageSub">No pudimos cargar esta lista.</div>
          <Link href="/smart-lists" className="ghost no-icon" style={{ marginTop: 8 }}>
            Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="panel module" style={{ marginBottom: 12 }}>
        <div className="panelHeaderRow">
          <div>
            <div className="pageTitle">{list.name}</div>
            <div className="pageSub">Label: {list.chatwootLabel || "—"}</div>
          </div>
          <Link href="/smart-lists" className="ghost no-icon">Volver</Link>
        </div>
      </div>

      <div className="panel module">
        <div className="panelHeaderRow" style={{ marginBottom: 8 }}>
          <div className="pageTitle">Contactos activos</div>
        </div>
        {items.length === 0 ? <div className="muted">Sin contactos.</div> : null}
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((m: any) => (
            <div key={m.id} className="panel" style={{ padding: 10 }}>
              <strong>{m.customer?.name || "Sin nombre"}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {m.customer?.email || "—"} · {m.customer?.phone || "—"}
              </div>
            </div>
          ))}
        </div>
        {(() => {
          const currentPage = Math.max(1, Number(page) || 1);
          const hasNext = total > 0 ? currentPage < Math.max(1, Math.ceil(total / take)) : items.length >= take;
          const totalPages = total > 0 ? Math.max(1, Math.ceil(total / take)) : currentPage + (hasNext ? 1 : 0);
          const desktopWindow = 10;
          let start = Math.max(1, currentPage - Math.floor(desktopWindow / 2));
          let end = start + (desktopWindow - 1);
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
          return (
            <div className="pagination pagination-indicator">
              <a className="page-link page-nav" href={`/smart-lists/${id}?page=${Math.max(1, currentPage - 1)}`} aria-disabled={currentPage <= 1}>
                Anterior
              </a>
              <div className="pagination-pages">
                {pages.map((p) => {
                  const isDesktopOnly = p < mobileStart || p > mobileEnd;
                  return (
                    <a
                      key={`smartlist-detail-${p}`}
                      className={`page-link ${p === currentPage ? "is-active" : ""} ${isDesktopOnly ? "page-desktop-only" : ""}`}
                      href={`/smart-lists/${id}?page=${p}`}
                      aria-current={p === currentPage ? "page" : undefined}
                    >
                      {p}
                    </a>
                  );
                })}
              </div>
              <a className="page-link page-nav" href={`/smart-lists/${id}?page=${currentPage + 1}`} aria-disabled={!hasNext}>
                Siguiente
              </a>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
