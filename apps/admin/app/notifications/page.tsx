import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";
import { getCsrfToken } from "../lib/csrf";
import { NotificationWizard } from "./NotificationWizard";
import { createNotification, deleteRule, deleteTemplate, toggleRule } from "./actions";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchConfig(environment: "PRODUCTION" | "SANDBOX") {
  return fetchAdminCached(`/admin/notifications/config?environment=${encodeURIComponent(environment)}`, { ttlMs: 1500 });
}

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: Promise<{ env?: string; saved?: string; error?: string; scheduled?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Notificaciones</h1>
        <p>Configura `ADMIN_API_TOKEN` en el Admin.</p>
      </main>
    );
  }

  const sp = (await searchParams) ?? {};
  const env = (String(sp.env || "").trim().toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const res = await fetchConfig(env);
  const config = res.ok ? (res.json?.config || {}) : {};
  const templates = Array.isArray(config?.templates) ? config.templates : [];
  const rules = Array.isArray(config?.rules) ? config.rules : [];

  const templateById = new Map<string, any>();
  templates.forEach((t: any) => templateById.set(String(t.id), t));

  function formatOffsets(offsets?: number[], atTimeUtc?: string) {
    if (!offsets?.length) return "Inmediato";
    const parts = offsets.map((sec) => {
      const s = Number(sec);
      if (!Number.isFinite(s) || s === 0) return "Inmediato";
      const dir = s < 0 ? "Antes" : "Después";
      const abs = Math.abs(s);
      const minutes = Math.round(abs / 60);
      if (minutes < 60) return `${dir} ${minutes} min`;
      const hours = Math.round(minutes / 60);
      if (hours < 24) return `${dir} ${hours} h`;
      const days = Math.round(hours / 24);
      return `${dir} ${days} d`;
    });
    const time = atTimeUtc ? ` · ${atTimeUtc} UTC` : "";
    return `${Array.from(new Set(parts)).join(", ")}${time}`;
  }

  function triggerLabel(trigger: string) {
    if (trigger === "SUBSCRIPTION_DUE") return "Suscripción: fecha de pago";
    if (trigger === "PAYMENT_LINK_CREATED") return "Pago: link creado";
    if (trigger === "PAYMENT_APPROVED") return "Pago: aprobado";
    if (trigger === "PAYMENT_DECLINED") return "Pago: fallido";
    return trigger || "—";
  }

  function paymentTypeLabel(rule: any) {
    const types = rule?.conditions?.requirePaymentTypeIn;
    if (!Array.isArray(types) || !types.length) return "Todos";
    return types.map((t: string) => (t === "PLAN" ? "Plan" : t === "SUBSCRIPTION" ? "Suscripción" : t === "LINK" ? "Link" : t)).join(", ");
  }

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <div className="panelHeaderRow">
        <h1 style={{ marginTop: 0 }}>Notificaciones</h1>
        <form action="/notifications" method="GET" style={{ display: "flex", gap: 10, alignItems: "end" }}>
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Entorno</span>
              <HelpTip text="Selecciona Producción o Sandbox para ver y crear reglas." />
            </label>
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

      {sp.saved ? <div className="card cardPad">Guardado.</div> : null}
      {typeof sp.scheduled === "string" ? <div className="card cardPad">Jobs programados: {sp.scheduled}.</div> : null}
      {sp.error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {String(sp.error)}
        </div>
      ) : null}

      {!res.ok ? (
        <div className="card cardPad">
          No se pudo consultar el API (
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{res.status || "sin respuesta"}</span>). Revisa `NEXT_PUBLIC_API_BASE_URL` y el token del Admin.
        </div>
      ) : null}

      {res.ok ? (
        <section className="settings-group">
          <div className="settings-group-header">
            <div className="panelHeaderRow">
              <h3>Resumen</h3>
            </div>
          </div>
          <div className="settings-group-body">
            <div className="saved-connections-grid">
              <div className="saved-conn-card">
                <strong>Reglas</strong>
                <div className="saved-conn-sub">{rules.length} activas / configuradas</div>
              </div>
              <div className="saved-conn-card">
                <strong>Plantillas</strong>
                <div className="saved-conn-sub">{templates.length} guardadas</div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {res.ok ? (
        <section className="settings-group">
          <div className="settings-group-header">
            <div className="panelHeaderRow">
              <h3>Reglas configuradas</h3>
            </div>
          </div>
          <div className="settings-group-body">
            {!rules.length ? (
              <div className="card cardPad">Aún no hay reglas configuradas.</div>
            ) : (
              <div className="panel module" style={{ display: "grid", gap: 10 }}>
                {rules.map((rule: any) => {
                  const template = templateById.get(String(rule.templateId));
                  return (
                    <div key={rule.id} className="saved-conn-card">
                      <div className="saved-conn-header">
                        <div>
                          <strong>{rule.name || "Sin nombre"}</strong>
                          <div className="saved-conn-sub">{triggerLabel(String(rule.trigger || ""))}</div>
                        </div>
                        <span className={`pill ${rule.enabled ? "pill-green" : "pill-muted"}`}>{rule.enabled ? "Activa" : "Inactiva"}</span>
                      </div>
                      <div className="saved-conn-meta">
                        <div className="saved-conn-meta-item">
                          <span className="saved-conn-meta-label">Plantilla</span>
                          <span className="saved-conn-meta-value">{template?.name || rule.templateId || "—"}</span>
                        </div>
                        <div className="saved-conn-meta-item">
                          <span className="saved-conn-meta-label">Canal</span>
                          <span className="saved-conn-meta-value">{template?.channel || "CHATWOOT"}</span>
                        </div>
                        <div className="saved-conn-meta-item">
                          <span className="saved-conn-meta-label">Aplica a</span>
                          <span className="saved-conn-meta-value">{paymentTypeLabel(rule)}</span>
                        </div>
                        <div className="saved-conn-meta-item">
                          <span className="saved-conn-meta-label">Envío</span>
                          <span className="saved-conn-meta-value">{formatOffsets(rule.offsetsSeconds, rule.atTimeUtc)}</span>
                        </div>
                      </div>
                      <div className="saved-conn-actions">
                        <form action={toggleRule}>
                          <input type="hidden" name="csrf" value={csrfToken} />
                          <input type="hidden" name="environment" value={env} />
                          <input type="hidden" name="ruleId" value={rule.id} />
                          <input type="hidden" name="enabled" value={rule.enabled ? "0" : "1"} />
                          <button className="ghost" type="submit">{rule.enabled ? "Desactivar" : "Activar"}</button>
                        </form>
                        <form action={deleteRule}>
                          <input type="hidden" name="csrf" value={csrfToken} />
                          <input type="hidden" name="environment" value={env} />
                          <input type="hidden" name="ruleId" value={rule.id} />
                          <button className="ghost" type="submit">Eliminar</button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {res.ok ? (
        <section className="settings-group">
          <div className="settings-group-header">
            <div className="panelHeaderRow">
              <h3>Plantillas guardadas</h3>
            </div>
          </div>
          <div className="settings-group-body">
            {!templates.length ? (
              <div className="card cardPad">Aún no hay plantillas guardadas.</div>
            ) : (
              <div className="saved-connections-grid">
                {templates.map((tpl: any) => (
                  <div key={tpl.id} className="saved-conn-card">
                    <div className="saved-conn-header">
                      <div>
                        <strong>{tpl.name}</strong>
                        <div className="saved-conn-sub">{tpl.channel || "CHATWOOT"}</div>
                      </div>
                    </div>
                    <div className="saved-conn-meta">
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Tipo</span>
                        <span className="saved-conn-meta-value">{tpl.chatwootType || "—"}</span>
                      </div>
                    </div>
                    <div className="saved-conn-actions">
                      <form action={deleteTemplate}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={env} />
                        <input type="hidden" name="templateId" value={tpl.id} />
                        <button className="ghost" type="submit">Eliminar</button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <NotificationWizard envDefault={env} createNotification={createNotification} csrfToken={csrfToken} />
    </main>
  );
}
