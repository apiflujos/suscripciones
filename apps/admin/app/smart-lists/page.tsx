import { normalizeErrorParam } from "../lib/errorParam";
import { HelpTip } from "../ui/HelpTip";
import { getCsrfToken } from "../lib/csrf";
import { createSmartList, previewSmartList, syncSmartList } from "./actions";
import { SmartListCreateModal } from "./SmartListCreateModal";
import { listSmartLists, previewSmartList as previewSmartListService } from "../admin/_services/smartLists";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";

type Preview = { count: number; sample: Array<{ id: string; name?: string; email?: string; phone?: string }> } | null;

async function fetchPreview(id: string): Promise<Preview> {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const out = await previewSmartListService({ id, tenantId: session?.tenantId || null });
  if (!out.ok) return null;
  return { count: out.count, sample: out.sample };
}

export default async function SmartListsPage({
  searchParams
}: {
  searchParams?: Promise<{
    preview?: string;
    error?: string;
    created?: string;
    synced?: string;
    preset?: string;
    name?: string;
    description?: string;
    rules?: string;
    page?: string;
  }>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const listsRes = await listSmartLists({ tenantId: session?.tenantId || null, take, skip });
  const items = listsRes.ok ? listsRes.items : [];
  const total = listsRes.ok ? Number(listsRes.total ?? items.length) : items.length;
  const previewId = String(sp.preview || "").trim();
  const preview = previewId ? await fetchPreview(previewId) : null;
  const preset = String(sp.preset || "").trim();
  const prefillName = String(sp.name || "").trim();
  const prefillDescription = String(sp.description || "").trim();
  const nowIso = new Date().toISOString();
  const rulesRaw = String(sp.rules || "").trim();
  const returnTo = `/smart-lists?${new URLSearchParams({
    ...(previewId ? { preview: previewId } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;
  let initialRules: any = null;
  if (rulesRaw) {
    try {
      initialRules = JSON.parse(rulesRaw);
    } catch {
      initialRules = null;
    }
  }

  return (
    <div className="page">
      {normalizeErrorParam(sp.error) ? <div className="panel module">Error: {normalizeErrorParam(sp.error)}</div> : null}
      {sp.created ? <div className="panel module">Lista creada.</div> : null}
      {sp.synced ? <div className="panel module">Sync: {sp.synced}</div> : null}

      <div className="panel module" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 4 }}>
              Gamificación <HelpTip text="Listas dinámicas que se recalculan según reglas para campañas y segmentación." />
            </h3>
            <div className="muted">Segmentos dinámicos de contactos para campañas.</div>
          </div>
          <SmartListCreateModal
            action={createSmartList}
            csrfToken={csrfToken}
            returnTo={returnTo}
            preset={preset || undefined}
            prefillName={prefillName}
            prefillDescription={prefillDescription}
            nowIso={nowIso}
            initialRules={initialRules || undefined}
          />
        </div>
      </div>

      <div className="panel module">
        <h3 style={{ marginTop: 0 }}>Listas</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {items.length === 0 ? <div className="muted">No hay listas aún.</div> : null}
          {items.map((item: any) => (
            <div key={item.id} className="panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <strong>{item.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {item.enabled ? "Activa" : "Inactiva"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <a className="ghost btn-view" href={`/smart-lists/${item.id}`} title="Ver contactos que pertenecen a esta lista">
                    Ver contactos
                  </a>
                  <form action={previewSmartList}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button className="ghost" type="submit" title="Previsualizar muestra de contactos">
                      Preview
                    </button>
                  </form>
                  <form action={syncSmartList}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button className="ghost" type="submit" title="Recalcular miembros de la lista ahora">
                      Recalcular
                    </button>
                  </form>
                </div>
              </div>
              {previewId === item.id && preview ? (
                <div style={{ marginTop: 8 }}>
                  <div className="muted">Coincidencias: {preview.count}</div>
                  {preview.sample?.length ? (
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      {preview.sample.map((c) => `${c.name || "—"} (${c.email || c.phone || "sin contacto"})`).join(" · ")}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
          const baseParams = { ...(sp.preview ? { preview: String(sp.preview) } : {}) };
          return (
            <div className="pagination pagination-indicator">
              <a
                className="page-link page-nav"
                href={`/smart-lists?${new URLSearchParams({ ...baseParams, page: String(Math.max(1, currentPage - 1)) })}`}
                aria-disabled={currentPage <= 1}
              >
                Anterior
              </a>
              <div className="pagination-pages">
                {pages.map((p) => {
                  const isDesktopOnly = p < mobileStart || p > mobileEnd;
                  return (
                    <a
                      key={`smartlists-page-${p}`}
                      className={`page-link ${p === currentPage ? "is-active" : ""} ${isDesktopOnly ? "page-desktop-only" : ""}`}
                      href={`/smart-lists?${new URLSearchParams({ ...baseParams, page: String(p) })}`}
                      aria-current={p === currentPage ? "page" : undefined}
                    >
                      {p}
                    </a>
                  );
                })}
              </div>
              <a
                className="page-link page-nav"
                href={`/smart-lists?${new URLSearchParams({ ...baseParams, page: String(currentPage + 1) })}`}
                aria-disabled={!hasNext}
              >
                Siguiente
              </a>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
