import { fetchAdminCached } from "../lib/adminApi";
import { normalizeErrorParam } from "../lib/errorParam";
import { HelpTip } from "../ui/HelpTip";
import { getCsrfToken } from "../lib/csrf";
import { createCampaign, runCampaign } from "./actions";
import { RunCampaignButton } from "./RunCampaignButton";

export default async function CampaignsPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; created?: string; running?: string; page?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const listsRes = await fetchAdminCached("/admin/comms/smart-lists?take=200", { ttlMs: 0 });
  const lists = Array.isArray(listsRes?.json?.items) ? listsRes.json.items : [];
  const sp = (await searchParams) ?? {};
  const returnTo = `/campaigns?${new URLSearchParams(Object.fromEntries(Object.entries(sp).filter(([_, v]) => typeof v === "string" && v))).toString()}`;
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  const campaignsRes = await fetchAdminCached(`/admin/comms/campaigns?take=${take}&skip=${skip}`, { ttlMs: 0 });
  const items = Array.isArray(campaignsRes?.json?.items) ? campaignsRes.json.items : [];

  return (
    <div className="page pageWide">

      {normalizeErrorParam(sp.error) ? <div className="panel module">Error: {normalizeErrorParam(sp.error)}</div> : null}
      {sp.created ? <div className="panel module">Campaña creada.</div> : null}
      {sp.running ? <div className="panel module">Campaña en cola.</div> : null}

      <div className="panel module" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Nueva campaña</h3>
        <form action={createCampaign} style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Nombre</span>
              <HelpTip text="Identificador interno de la campaña." />
            </label>
            <input className="input" name="name" required />
          </div>
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Lista inteligente</span>
              <HelpTip text="Segmento de contactos que recibirá el envío." />
            </label>
            <select className="select" name="smartListId" required>
              <option value="">Selecciona una lista</option>
              {lists.map((l: any) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Mensaje</span>
              <HelpTip text="Texto que se enviará a cada contacto." />
            </label>
            <textarea className="input" name="content" rows={4} required />
          </div>
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Template params (JSON opcional)</span>
              <HelpTip text='Solo si usas plantilla. Ej: {"name":"Juan","amount":"$49.000"}.' />
            </label>
            <textarea className="input" name="templateParams" rows={3} placeholder='{"name":"Juan","amount":"$49.000"}' />
          </div>
          <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="primary btn-create" type="submit">Crear</button>
          </div>
        </form>
      </div>

      <div className="panel module">
        <h3 style={{ marginTop: 0 }}>Historial</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {items.length === 0 ? <div className="muted">No hay campañas aún.</div> : null}
          {items.map((c: any) => (
            <div key={c.id} className="panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Estado: {c.status} · Enviados: {c.sentCount} · Fallidos: {c.failedCount}
                  </div>
                </div>
                <form action={runCampaign}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <RunCampaignButton disabled={c.status === "RUNNING" || c.status === "COMPLETED"} />
                </form>
              </div>
              {c.content ? (
                <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 13 }}>
                  {c.content}
                </div>
              ) : null}
              {c.templateParams ? (
                <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(c.templateParams, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
        {(() => {
          const currentPage = Math.max(1, Number(page) || 1);
          const hasNext = items.length >= take;
          const start = Math.max(1, currentPage - 2);
          const end = hasNext ? currentPage + 2 : currentPage;
          const pages = [];
          for (let i = start; i <= end; i += 1) pages.push(i);
          return (
            <div className="pagination">
              <a className="ghost no-icon page-link page-nav" href={`/campaigns?page=${Math.max(1, currentPage - 1)}`} aria-disabled={currentPage <= 1}>
                Anterior
              </a>
              <div className="pagination-pages">
                {pages.map((p) => (
                  <a
                    key={`campaigns-page-${p}`}
                    className={`ghost no-icon page-link ${p === currentPage ? "is-active" : ""}`}
                    href={`/campaigns?page=${p}`}
                    aria-current={p === currentPage ? "page" : undefined}
                  >
                    {p}
                  </a>
                ))}
              </div>
              <a className="ghost no-icon page-link page-nav" href={`/campaigns?page=${currentPage + 1}`} aria-disabled={!hasNext}>
                Siguiente
              </a>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
