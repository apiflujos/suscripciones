import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { NotificationWizard } from "./NotificationWizard";
import { createNotification, deleteRule, deleteTemplate, scheduleSubscription, toggleRule } from "./actions";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchConfig(environment: "PRODUCTION" | "SANDBOX") {
  return fetchAdminCached(`/admin/notifications/config?environment=${encodeURIComponent(environment)}`, { ttlMs: 1500 });
}

function labelTrigger(t: any) {
  const v = String(t || "");
  if (v === "SUBSCRIPTION_DUE") return "Recordatorio (fecha de corte)";
  if (v === "PAYMENT_APPROVED") return "Pago aprobado";
  if (v === "PAYMENT_DECLINED") return "Pago rechazado";
  return v || "—";
}

function labelOffsetSeconds(r: any) {
  const seconds = Number((r?.offsetsSeconds?.[0] ?? (r?.offsetsMinutes?.[0] != null ? r.offsetsMinutes[0] * 60 : 0)) || 0);
  const abs = Math.abs(seconds);
  const dir = seconds < 0 ? "antes" : "después";
  if (abs % (24 * 3600) === 0) return `${abs / (24 * 3600)} días ${dir}`;
  if (abs % 3600 === 0) return `${abs / 3600} horas ${dir}`;
  if (abs % 60 === 0) return `${abs / 60} minutos ${dir}`;
  return `${abs} segundos ${dir}`;
}

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: { env?: string; saved?: string; error?: string; scheduled?: string };
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Notificaciones</h1>
        <p>Configura `API_ADMIN_TOKEN` (o `ADMIN_API_TOKEN`) en el Admin.</p>
      </main>
    );
  }

  const env = (String(searchParams?.env || "").trim().toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const res = await fetchConfig(env);
  const config = res.ok ? res.json?.config : null;
  const templates = (config?.templates ?? []) as any[];
  const rules = (config?.rules ?? []) as any[];

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <div className="panelHeaderRow">
        <h1 style={{ marginTop: 0 }}>Notificaciones</h1>
        <form action="/notifications" method="GET" style={{ display: "flex", gap: 10, alignItems: "end" }}>
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <label>Entorno</label>
            <select className="select" name="env" defaultValue={env}>
              <option value="PRODUCTION">Producción</option>
              <option value="SANDBOX">Sandbox</option>
            </select>
          </div>
          <button className="ghost" type="submit">
            Cambiar
          </button>
        </form>
      </div>

      {searchParams?.saved ? <div className="card cardPad">Guardado.</div> : null}
      {typeof searchParams?.scheduled === "string" ? <div className="card cardPad">Jobs programados: {searchParams.scheduled}.</div> : null}
      {searchParams?.error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {String(searchParams.error)}
        </div>
      ) : null}

      {!res.ok ? (
        <div className="card cardPad">
          No se pudo consultar el API (
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{res.status || "sin respuesta"}</span>). Revisa `NEXT_PUBLIC_API_BASE_URL` y el token del Admin.
        </div>
      ) : null}

      <NotificationWizard envDefault={env} createNotification={createNotification} />

      <details className="panel module" style={{ padding: 12 }}>
        <summary className="ghost detailsSummary">Administrar configuraciones existentes</summary>
        <div className="detailsBody" style={{ display: "grid", gap: 14 }}>
          <div className="field-hint">
            Plantillas: {templates.length} · Reglas: {rules.length}
          </div>

          <div className="panel module" style={{ display: "grid", gap: 10 }}>
            <strong>Reglas</strong>
            {rules.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {rules.map((r) => (
                  <div key={String(r.id)} className="card cardPad" style={{ display: "grid", gap: 8 }}>
                    <div className="panelHeaderRow">
                      <strong style={{ opacity: r.enabled === false ? 0.6 : 1 }}>{String(r.name || r.id)}</strong>
                      <div style={{ display: "flex", gap: 8 }}>
                        <form action={toggleRule}>
                          <input type="hidden" name="environment" value={env} />
                          <input type="hidden" name="ruleId" value={String(r.id)} />
                          <input type="hidden" name="enabled" value={String(r.enabled === false ? 1 : 0)} />
                          <button className="ghost" type="submit">
                            {r.enabled === false ? "Activar" : "Desactivar"}
                          </button>
                        </form>
                        <form action={deleteRule}>
                          <input type="hidden" name="environment" value={env} />
                          <input type="hidden" name="ruleId" value={String(r.id)} />
                          <button className="ghost" type="submit">
                            Eliminar
                          </button>
                        </form>
                      </div>
                    </div>
                    <div className="field-hint">
                      Evento: {labelTrigger(r.trigger)} · Tiempo: {labelOffsetSeconds(r)} · Plantilla:{" "}
                      <code>{String(templates.find((t) => String(t.id) === String(r.templateId))?.name || r.templateId || "—")}</code>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="field-hint">No hay reglas todavía.</div>
            )}
          </div>

          <div className="panel module" style={{ display: "grid", gap: 10 }}>
            <strong>Plantillas</strong>
            {templates.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {templates.map((t) => (
                  <div key={String(t.id)} className="card cardPad" style={{ display: "grid", gap: 6 }}>
                    <div className="panelHeaderRow">
                      <strong>{String(t.name || t.id)}</strong>
                      <form action={deleteTemplate}>
                        <input type="hidden" name="environment" value={env} />
                        <input type="hidden" name="templateId" value={String(t.id)} />
                        <button className="ghost" type="submit">
                          Eliminar
                        </button>
                      </form>
                    </div>
                    <div className="field-hint">
                      Tipo: {t.chatwootTemplate ? "Template WhatsApp" : "Mensaje"}
                      {t.chatwootTemplate ? (
                        <>
                          {" · "}template: <code>{String(t.chatwootTemplate?.name || "")}</code> · idioma: <code>{String(t.chatwootTemplate?.language || "")}</code>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="field-hint">No hay plantillas todavía.</div>
            )}
          </div>

          <details className="panel module" style={{ padding: 12 }}>
            <summary className="ghost detailsSummary">Programar recordatorios (para probar)</summary>
            <div className="detailsBody">
              <form action={scheduleSubscription} style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr auto" } as any}>
                <input type="hidden" name="environment" value={env} />
                <div className="field">
                  <label>Subscription ID</label>
                  <input className="input" name="subscriptionId" placeholder="uuid" />
                  <div style={{ marginTop: 8 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" name="forceNow" value="1" />
                      <span>forceNow</span>
                    </label>
                  </div>
                </div>
                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", alignItems: "end" }}>
                  <button className="primary" type="submit">
                    Programar
                  </button>
                </div>
              </form>
            </div>
          </details>
        </div>
      </details>
    </main>
  );
}

