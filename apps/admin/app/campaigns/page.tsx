import { normalizeErrorParam } from "../lib/errorParam";
import { getCsrfToken } from "../lib/csrf";
import { createCampaign, runCampaign } from "./actions";
import { RunCampaignButton } from "./RunCampaignButton";
import { NewMassMessageModal } from "./NewMassMessageModal";
import { listSmartLists } from "../admin/_services/smartLists";
import { listCampaigns } from "../admin/_services/campaigns";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";

function buildMessageOptions(templates: any[]) {
  const findByName = (name: string) =>
    templates.find((t) => String(t?.name || "").trim().toLowerCase() === name.trim().toLowerCase());
  const contentOf = (name: string) => String(findByName(name)?.content || "").trim();
  return [
    {
      key: "payment_link_created",
      label: "Link de pago",
      content: contentOf("Link de pago creado")
    },
    {
      key: "tokenization_link_created",
      label: "Guardar tarjeta (débito automático)",
      content: contentOf("Tokenización enviada")
    },
    {
      key: "reminder_due",
      label: "Recordatorio de pago",
      content: contentOf("Recordatorio de fecha de pago")
    },
    {
      key: "reminder_mora",
      label: "Recordatorio en mora",
      content: contentOf("Recordatorio en mora")
    }
  ].map((item) => ({
    ...item,
    content: item.content || "Configura este mensaje en Notificaciones para usarlo aquí."
  }));
}

export default async function CampaignsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const listsRes = await listSmartLists({ tenantId: session?.tenantId || null, take: 200, skip: 0 });
  const lists = listsRes.ok ? listsRes.items : [];
  const notificationsConfig = await getNotificationsConfigForEnv("PRODUCTION");
  const notificationsTemplates = Array.isArray((notificationsConfig as any)?.templates) ? (notificationsConfig as any).templates : [];
  const messageOptions = buildMessageOptions(notificationsTemplates);
  const sp = (await searchParams) ?? {};
  const returnTo = `/campaigns?${new URLSearchParams(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")) as Record<string, string>
  ).toString()}`;
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  const params = new URLSearchParams({ take: String(take), skip: String(skip) });
  const campaignsRes = await listCampaigns({ take, skip });
  const items = campaignsRes.ok ? campaignsRes.items : [];
  const total = campaignsRes.ok ? Number(campaignsRes.total ?? items.length) : items.length;

  return (
    <div className="page pageWide">

      {normalizeErrorParam(sp.error) ? <div className="panel module">Error: {normalizeErrorParam(sp.error)}</div> : null}
      {sp.created ? <div className="panel module">Campaña guardada.</div> : null}
      {sp.running ? <div className="panel module">Campaña en cola.</div> : null}

      <div className="panel module" style={{ marginBottom: 16 }}>
        <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 4 }}>Mensajes masivos</h3>
            <div className="muted">Crea campañas usando filtros inteligentes y plantillas configuradas.</div>
          </div>
          <NewMassMessageModal
            csrfToken={csrfToken}
            returnTo={returnTo}
            lists={lists.map((l: any) => ({ id: String(l.id), name: String(l.name) }))}
            messageOptions={messageOptions}
            action={createCampaign}
          />
        </div>
      </div>

      <div className="panel module">
        <h3 style={{ marginTop: 0 }}>Campañas guardadas</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {items.length === 0 ? <div className="muted">No hay campañas aún.</div> : null}
          {items.map((c: any) => (
            <div key={c.id} className="panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Enviados: {c.sentCount} · Fallidos: {c.failedCount} · Estado: {c.status}
                  </div>
                </div>
                <form action={runCampaign}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <RunCampaignButton disabled={c.status === "RUNNING"} label={c.sentCount > 0 ? "Reenviar" : "Enviar"} />
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
              <a className="page-link page-nav" href={`/campaigns?page=${Math.max(1, currentPage - 1)}`} aria-disabled={currentPage <= 1}>
                Anterior
              </a>
              <div className="pagination-pages">
                {pages.map((p) => {
                  const isDesktopOnly = p < mobileStart || p > mobileEnd;
                  return (
                    <a
                      key={`campaigns-page-${p}`}
                      className={`page-link ${p === currentPage ? "is-active" : ""} ${isDesktopOnly ? "page-desktop-only" : ""}`}
                      href={`/campaigns?page=${p}`}
                      aria-current={p === currentPage ? "page" : undefined}
                    >
                      {p}
                    </a>
                  );
                })}
              </div>
              <a className="page-link page-nav" href={`/campaigns?page=${currentPage + 1}`} aria-disabled={!hasNext}>
                Siguiente
              </a>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
