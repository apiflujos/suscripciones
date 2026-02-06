import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { addRule, addTextTemplate, addWhatsAppTemplate, deleteRule, deleteTemplate, saveNotificationsConfig, scheduleSubscription, toggleRule } from "./actions";
import { HelpTip } from "../ui/HelpTip";

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
  searchParams: { env?: string; saved?: string; error?: string; scheduled?: string };
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

  const env = (String(searchParams.env || "").trim().toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const res = await fetchConfig(env);
  const config = res.ok ? res.json?.config : null;
  const templates = (config?.templates ?? []) as any[];
  const rules = (config?.rules ?? []) as any[];
  const pretty = config ? JSON.stringify(config, null, 2) : "";

  function labelTrigger(t: any) {
    const v = String(t || "");
    if (v === "SUBSCRIPTION_DUE") return "Recordatorio de pago (por fecha de corte)";
    if (v === "PAYMENT_APPROVED") return "Notificación de éxito (pago aprobado)";
    if (v === "PAYMENT_DECLINED") return "Notificación fallida (pago rechazado)";
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

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <div className="panelHeaderRow">
        <h1 style={{ marginTop: 0 }}>Notificaciones</h1>
        <form action="/notifications" method="GET" style={{ display: "flex", gap: 10, alignItems: "center" }}>
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

      {searchParams.saved ? <div className="card cardPad">Guardado.</div> : null}
      {typeof searchParams.scheduled === "string" ? <div className="card cardPad">Jobs programados: {searchParams.scheduled}.</div> : null}
      {searchParams.error ? (
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

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Plantillas</h3>
              <HelpTip text="Crea mensajes (texto normal) o templates de WhatsApp (si tu inbox de Chatwoot lo soporta)." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <div className="panel module" style={{ display: "grid", gap: 10 }}>
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
                      Tipo: {t.chatwootTemplate ? "Template WhatsApp" : "Mensaje"} · Uso en reglas:{" "}
                      {rules.filter((r) => String(r.templateId) === String(t.id)).length}
                    </div>
                    {t.chatwootTemplate ? (
                      <div className="field-hint">
                        Template: <code>{String(t.chatwootTemplate?.name || "")}</code> · idioma: <code>{String(t.chatwootTemplate?.language || "")}</code>
                      </div>
                    ) : (
                      <div className="field-hint">Contenido: {String(t.content || "").slice(0, 180) || "—"}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="field-hint">No hay plantillas todavía.</div>
            )}
          </div>

          <details className="panel module" style={{ padding: 12 }}>
            <summary className="ghost detailsSummary">Nueva plantilla (mensaje normal)</summary>
            <div className="detailsBody">
              <form action={addTextTemplate} style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="environment" value={env} />
                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" placeholder="Ej: Recordatorio de pago" />
                </div>
                <div className="field">
                  <label>Categoría</label>
                  <select className="select" name="chatwootType" defaultValue="EXPIRY_WARNING">
                    <option value="EXPIRY_WARNING">Recordatorio de pago</option>
                    <option value="PAYMENT_CONFIRMED">Pago aprobado</option>
                    <option value="PAYMENT_FAILED">Pago fallido</option>
                    <option value="PAYMENT_LINK">Link de pago</option>
                  </select>
                </div>
                <div className="field">
                  <label>Mensaje</label>
                  <textarea
                    className="input"
                    name="content"
                    rows={6}
                    placeholder="Ej: Hola {{customer.name}}, paga aquí: {{payment.checkoutUrl}}"
                    style={{ padding: 12 }}
                  />
                  <div className="field-hint">
                    Variables: <code>{"{{customer.name}}"}</code>, <code>{"{{plan.name}}"}</code>, <code>{"{{subscription.currentPeriodEndAt}}"}</code>, <code>{"{{payment.checkoutUrl}}"}</code>, <code>{"{{payment.reference}}"}</code>.
                  </div>
                </div>
                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="primary" type="submit">
                    Crear
                  </button>
                </div>
              </form>
            </div>
          </details>

          <details className="panel module" style={{ padding: 12 }}>
            <summary className="ghost detailsSummary">Nueva plantilla (template WhatsApp)</summary>
            <div className="detailsBody">
              <form action={addWhatsAppTemplate} style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="environment" value={env} />
                <div className="field">
                  <label>Nombre interno</label>
                  <input className="input" name="name" placeholder="Ej: Template vencimiento" />
                </div>
                <div className="field">
                  <label>Categoría</label>
                  <select className="select" name="chatwootType" defaultValue="EXPIRY_WARNING">
                    <option value="EXPIRY_WARNING">Recordatorio de pago</option>
                    <option value="PAYMENT_CONFIRMED">Pago aprobado</option>
                    <option value="PAYMENT_FAILED">Pago fallido</option>
                    <option value="PAYMENT_LINK">Link de pago</option>
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 10 }}>
                  <div className="field">
                    <label>Template name (Meta)</label>
                    <input className="input" name="templateName" placeholder="nombre_template" />
                  </div>
                  <div className="field">
                    <label>Idioma</label>
                    <input className="input" name="language" placeholder="es" defaultValue="es" />
                  </div>
                </div>
                <div className="field">
                  <label>Parámetros del body (1..10)</label>
                  <div style={{ display: "grid", gap: 8 }}>
                    {Array.from({ length: 5 }).map((_, idx) => (
                      <input key={idx} className="input" name={`bodyParam${idx + 1}`} placeholder={`Param ${idx + 1} (ej: {{customer.name}})`} />
                    ))}
                  </div>
                  <div className="field-hint">Se envían como <code>processed_params.body</code> con keys 1..N.</div>
                </div>
                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="primary" type="submit">
                    Crear
                  </button>
                </div>
              </form>
            </div>
          </details>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Reglas</h3>
              <HelpTip text="Define cuándo se envía cada mensaje: antes/después de la fecha de corte, o al aprobar/rechazar un pago." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <div className="panel module" style={{ display: "grid", gap: 10 }}>
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
                      Evento: {labelTrigger(r.trigger)} · Tiempo: {labelOffsetSeconds(r)}
                    </div>
                    <div className="field-hint">
                      Plantilla:{" "}
                      <code>{String(templates.find((t) => String(t.id) === String(r.templateId))?.name || r.templateId || "—")}</code>
                      {r.trigger === "SUBSCRIPTION_DUE" ? (
                        <>
                          {" · "}Link de pago: {r.ensurePaymentLink ? "sí" : "no"}
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="field-hint">No hay reglas todavía.</div>
            )}
          </div>

          <details className="panel module" style={{ padding: 12 }}>
            <summary className="ghost detailsSummary">Nueva regla</summary>
            <div className="detailsBody">
              <form action={addRule} style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="environment" value={env} />
                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" placeholder="Ej: Recordatorio 1 día antes" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field">
                    <label>Evento</label>
                    <select className="select" name="trigger" defaultValue="SUBSCRIPTION_DUE">
                      <option value="SUBSCRIPTION_DUE">Recordatorio de pago (si aún no pagó)</option>
                      <option value="PAYMENT_APPROVED">Pago aprobado</option>
                      <option value="PAYMENT_DECLINED">Pago rechazado</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Plantilla</label>
                    <select className="select" name="templateId">
                      {templates.map((t) => (
                        <option key={String(t.id)} value={String(t.id)}>
                          {String(t.name || t.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 180px 1fr", gap: 10, alignItems: "end" } as any}>
                  <div className="field">
                    <label>Antes/Después</label>
                    <select className="select" name="direction" defaultValue="before">
                      <option value="before">Antes</option>
                      <option value="after">Después</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Cantidad</label>
                    <input className="input" name="amount" defaultValue="60" />
                  </div>
                  <div className="field">
                    <label>Unidad</label>
                    <select className="select" name="unit" defaultValue="minutes">
                      <option value="seconds">Segundos</option>
                      <option value="minutes">Minutos</option>
                      <option value="hours">Horas</option>
                      <option value="days">Días</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Opciones</label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                      <input type="checkbox" name="ensurePaymentLink" value="1" defaultChecked />
                      <span>Generar link si falta (recordatorios)</span>
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                      <input type="checkbox" name="enabled" value="1" defaultChecked />
                      <span>Activa</span>
                    </label>
                  </div>
                </div>

                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="primary" type="submit">
                    Crear regla
                  </button>
                </div>
              </form>
            </div>
          </details>

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

          <details className="panel module" style={{ padding: 12 }}>
            <summary className="ghost detailsSummary">Avanzado: editar JSON</summary>
            <div className="detailsBody">
              <form action={saveNotificationsConfig} className="panel module" style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="environment" value={env} />
                <div className="field">
                  <label>JSON</label>
                  <textarea
                    className="input"
                    name="configJson"
                    rows={18}
                    defaultValue={pretty}
                    style={{ padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                  />
                </div>
                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="primary" type="submit">
                    Guardar JSON
                  </button>
                </div>
              </form>
            </div>
          </details>
        </div>
      </section>
    </main>
  );
}
