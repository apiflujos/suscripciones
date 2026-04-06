"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { AppModal } from "../ui/AppModal";

type Env = "PRODUCTION" | "SANDBOX";

type Template = {
  id: string;
  name: string;
  channel: "CHATWOOT" | "META";
  chatwootType?: "PAYMENT_LINK" | "PAYMENT_CONFIRMED" | "EXPIRY_WARNING" | "PAYMENT_FAILED";
  content?: string | null;
  chatwootTemplate?: {
    name: string;
    language: string;
    processed_params?: { body?: Array<{ key: string; value: string }> };
  } | null;
  meta?: {
    templateName: string;
    language: string;
    components?: any;
  } | null;
};

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "SUBSCRIPTION_DUE" | "PAYMENT_LINK_CREATED" | "CATALOG_LINK_CREATED" | "PAYMENT_APPROVED" | "PAYMENT_DECLINED";
  templateId: string;
  offsetsSeconds?: number[];
  atTimeUtc?: string | null;
  ensurePaymentLink?: boolean;
  conditions?: {
    requirePaymentTypeIn?: Array<"PLAN" | "SUBSCRIPTION" | "LINK">;
  };
};

type OffsetItem = { direction: "before" | "after"; amount: string; unit: "seconds" | "minutes" | "hours" | "days" };

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
  if (trigger === "CATALOG_LINK_CREATED") return "Catálogo enviado";
  if (trigger === "PAYMENT_APPROVED") return "Pago: aprobado";
  if (trigger === "PAYMENT_DECLINED") return "Pago: fallido";
  return trigger || "—";
}

function paymentTypeLabel(rule: Rule) {
  const types = rule?.conditions?.requirePaymentTypeIn;
  if (!Array.isArray(types) || !types.length) return "Todos";
  return types.map((t) => (t === "PLAN" ? "Link de pago" : t === "SUBSCRIPTION" ? "Suscripción" : t === "LINK" ? "Link" : t)).join(", ");
}

function offsetsToList(offsets?: number[]): OffsetItem[] {
  if (!offsets?.length) return [{ direction: "after", amount: "0", unit: "minutes" }];
  return offsets.map((sec) => {
    const s = Number(sec);
    const direction: "before" | "after" = s < 0 ? "before" : "after";
    const abs = Math.abs(s);
    if (abs % (24 * 60 * 60) === 0) return { direction, amount: String(abs / (24 * 60 * 60)), unit: "days" };
    if (abs % (60 * 60) === 0) return { direction, amount: String(abs / (60 * 60)), unit: "hours" };
    if (abs % 60 === 0) return { direction, amount: String(abs / 60), unit: "minutes" };
    return { direction, amount: String(abs), unit: "seconds" };
  });
}

function offsetItemToSeconds(item: OffsetItem) {
  const amount = Number(item.amount);
  const base =
    item.unit === "seconds" ? amount :
    item.unit === "minutes" ? amount * 60 :
    item.unit === "hours" ? amount * 60 * 60 :
    item.unit === "days" ? amount * 24 * 60 * 60 :
    amount * 60;
  const signed = item.direction === "before" ? -base : base;
  return Number.isFinite(signed) ? Math.trunc(signed) : 0;
}

export function NotificationsManager({
  env,
  csrfToken,
  templates,
  rules,
  actions
}: {
  env: Env;
  csrfToken: string;
  templates: Template[];
  rules: Rule[];
  actions: {
    deleteTemplate: (formData: FormData) => void;
    deleteRule: (formData: FormData) => void;
    toggleRule: (formData: FormData) => void;
    updateTemplate: (formData: FormData) => void;
    updateRule: (formData: FormData) => void;
  };
}) {
  const templateById = useMemo(() => {
    const map = new Map<string, Template>();
    templates.forEach((t) => map.set(String(t.id), t));
    return map;
  }, [templates]);

  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const [tplName, setTplName] = useState("");
  const [tplChannel, setTplChannel] = useState<"CHATWOOT" | "META">("CHATWOOT");
  const [tplChatwootType, setTplChatwootType] = useState<Template["chatwootType"]>("PAYMENT_LINK");
  const [tplKind, setTplKind] = useState<"TEXT" | "WHATSAPP_TEMPLATE">("TEXT");
  const [tplContent, setTplContent] = useState("");
  const [tplWaName, setTplWaName] = useState("");
  const [tplWaLanguage, setTplWaLanguage] = useState("es");
  const [tplWaParams, setTplWaParams] = useState<string[]>([]);
  const [tplMetaName, setTplMetaName] = useState("");
  const [tplMetaLang, setTplMetaLang] = useState("es");
  const [tplMetaComponents, setTplMetaComponents] = useState<string>("");

  const [ruleName, setRuleName] = useState("");
  const [ruleEnabled, setRuleEnabled] = useState(true);
  const [ruleTrigger, setRuleTrigger] = useState<Rule["trigger"]>("SUBSCRIPTION_DUE");
  const [ruleTemplateId, setRuleTemplateId] = useState("");
  const [rulePaymentType, setRulePaymentType] = useState<"ANY" | "PLAN" | "SUBSCRIPTION" | "LINK">("ANY");
  const [ruleEnsurePaymentLink, setRuleEnsurePaymentLink] = useState(true);
  const [ruleAtTimeUtc, setRuleAtTimeUtc] = useState("");
  const [ruleOffsets, setRuleOffsets] = useState<OffsetItem[]>([{ direction: "before", amount: "1", unit: "days" }]);
  const paymentTypeEnabled =
    ruleTrigger === "PAYMENT_LINK_CREATED" || ruleTrigger === "CATALOG_LINK_CREATED" || ruleTrigger === "PAYMENT_DECLINED";

  useEffect(() => {
    if (!paymentTypeEnabled) setRulePaymentType("ANY");
  }, [paymentTypeEnabled]);

  function openTemplateModal(t: Template) {
    setEditingTemplate(t);
    setTplName(t.name || "");
    setTplChannel(t.channel || "CHATWOOT");
    setTplChatwootType(t.chatwootType || "PAYMENT_LINK");
    if (t.channel === "META") {
      setTplKind("TEXT");
      setTplContent("");
      setTplWaName("");
      setTplWaLanguage("es");
      setTplWaParams([]);
      setTplMetaName(t.meta?.templateName || "");
      setTplMetaLang(t.meta?.language || "es");
      setTplMetaComponents(t.meta?.components ? JSON.stringify(t.meta.components, null, 2) : "");
      return;
    }
    const hasWa = Boolean(t.chatwootTemplate?.name);
    setTplKind(hasWa ? "WHATSAPP_TEMPLATE" : "TEXT");
    setTplContent(t.content && t.content !== "(template)" ? String(t.content) : "");
    setTplWaName(t.chatwootTemplate?.name || "");
    setTplWaLanguage(t.chatwootTemplate?.language || "es");
    const params = t.chatwootTemplate?.processed_params?.body || [];
    setTplWaParams(params.map((p) => p.value || ""));
    setTplMetaName("");
    setTplMetaLang("es");
    setTplMetaComponents("");
  }

  function openRuleModal(r: Rule) {
    setEditingRule(r);
    setRuleName(r.name || "");
    setRuleEnabled(Boolean(r.enabled));
    setRuleTrigger(r.trigger || "SUBSCRIPTION_DUE");
    setRuleTemplateId(String(r.templateId || ""));
    const types = r.conditions?.requirePaymentTypeIn;
    setRulePaymentType(types && types.length ? (types[0] as any) : "ANY");
    setRuleEnsurePaymentLink(Boolean(r.ensurePaymentLink));
    setRuleAtTimeUtc(String(r.atTimeUtc || ""));
    setRuleOffsets(offsetsToList(r.offsetsSeconds));
  }

  function closeModals() {
    setEditingTemplate(null);
    setEditingRule(null);
  }

  return (
    <>
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
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

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <h3>Reglas configuradas</h3>
          </div>
        </div>
        <div className="settings-group-body">
          {!rules.length ? (
            <div className="card cardPad">Aún no hay reglas configuradas.</div>
          ) : (
            <div className="panel module" style={{ display: "grid", gap: 10 }}>
              {rules.map((rule) => {
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
                        <span className="saved-conn-meta-value">{formatOffsets(rule.offsetsSeconds, rule.atTimeUtc || undefined)}</span>
                      </div>
                    </div>
                    <div className="saved-conn-actions">
                      <button className="ghost" type="button" data-modal="true" data-loader="off" onClick={() => openRuleModal(rule)}>Editar</button>
                      <form action={actions.toggleRule}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={env} />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="enabled" value={rule.enabled ? "0" : "1"} />
                        <PendingButton className="ghost" type="submit" pendingText={rule.enabled ? "Desactivando..." : "Activando..."}>
                          {rule.enabled ? "Desactivar" : "Activar"}
                        </PendingButton>
                      </form>
                      <form action={actions.deleteRule}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={env} />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <PendingButton
                          className="ghost btn-compact btn-red btn-delete-icon"
                          type="submit"
                          pendingText="Eliminando..."
                          aria-label="Eliminar regla"
                          title="Eliminar regla"
                        >
                          Eliminar
                        </PendingButton>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <h3>Plantillas guardadas</h3>
          </div>
        </div>
        <div className="settings-group-body">
          {!templates.length ? (
            <div className="card cardPad">Aún no hay plantillas guardadas.</div>
          ) : (
            <div className="saved-connections-grid">
              {templates.map((tpl) => (
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
                    <button className="ghost" type="button" data-modal="true" data-loader="off" onClick={() => openTemplateModal(tpl)}>Editar</button>
                    <form action={actions.deleteTemplate}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="environment" value={env} />
                      <input type="hidden" name="templateId" value={tpl.id} />
                      <PendingButton
                        className="ghost btn-compact btn-red btn-delete-icon"
                        type="submit"
                        pendingText="Eliminando..."
                        aria-label="Eliminar plantilla"
                        title="Eliminar plantilla"
                      >
                        Eliminar
                      </PendingButton>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {editingTemplate ? (
        <AppModal open={Boolean(editingTemplate)} onClose={closeModals} title="Editar plantilla" maxWidth={720}>
            <form action={actions.updateTemplate} className="panel module" style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="environment" value={env} />
              <input type="hidden" name="templateId" value={editingTemplate.id} />
              <div className="field">
                <label>Nombre</label>
                <input className="input" value={tplName} onChange={(e) => setTplName(e.target.value)} />
              </div>
              <div className="field">
                <label>Canal</label>
                <select className="select" value={tplChannel} onChange={(e) => setTplChannel(e.target.value as any)}>
                  <option value="CHATWOOT">CHATWOOT</option>
                  <option value="META">META</option>
                </select>
              </div>

              {tplChannel === "CHATWOOT" ? (
                <>
                  <div className="field">
                    <label>Tipo (CentralCom)</label>
                    <select className="select" value={tplChatwootType} onChange={(e) => setTplChatwootType(e.target.value as any)}>
                      <option value="PAYMENT_LINK">PAYMENT_LINK</option>
                      <option value="PAYMENT_CONFIRMED">PAYMENT_CONFIRMED</option>
                      <option value="EXPIRY_WARNING">EXPIRY_WARNING</option>
                      <option value="PAYMENT_FAILED">PAYMENT_FAILED</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Tipo de plantilla</label>
                    <select className="select" value={tplKind} onChange={(e) => setTplKind(e.target.value as any)}>
                      <option value="TEXT">Mensaje normal</option>
                      <option value="WHATSAPP_TEMPLATE">Template WhatsApp</option>
                    </select>
                  </div>
                  {tplKind === "TEXT" ? (
                    <div className="field">
                      <label>Mensaje</label>
                      <textarea className="input" rows={6} value={tplContent} onChange={(e) => setTplContent(e.target.value)} />
                    </div>
                  ) : (
                    <>
                      <div className="field">
                        <label>Nombre plantilla WhatsApp</label>
                        <input className="input" value={tplWaName} onChange={(e) => setTplWaName(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Parámetros (body)</label>
                        <div style={{ display: "grid", gap: 6 }}>
                          {tplWaParams.map((v, idx) => (
                            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                              <input className="input" value={v} onChange={(e) => setTplWaParams((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))} />
                              <button type="button" className="ghost" onClick={() => setTplWaParams((prev) => prev.filter((_, i) => i !== idx))}>Quitar</button>
                            </div>
                          ))}
                          <button type="button" className="ghost" onClick={() => setTplWaParams((prev) => [...prev, ""])}>+ Agregar parámetro</button>
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="field">
                    <label>Template (Meta)</label>
                    <input className="input" value={tplMetaName} onChange={(e) => setTplMetaName(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Components (JSON)</label>
                    <textarea className="input" rows={6} value={tplMetaComponents} onChange={(e) => setTplMetaComponents(e.target.value)} />
                  </div>
                </>
              )}

              <input type="hidden" name="name" value={tplName} />
              <input type="hidden" name="channel" value={tplChannel} />
              <input type="hidden" name="chatwootType" value={tplChatwootType || ""} />
              <input type="hidden" name="content" value={tplContent} />
              <input type="hidden" name="waTemplateName" value={tplWaName} />
              <input type="hidden" name="waLanguage" value={tplWaLanguage} />
              <input type="hidden" name="waParams" value={tplWaParams.join("|")} />
              <input type="hidden" name="metaTemplateName" value={tplMetaName} />
              <input type="hidden" name="metaLanguage" value={tplMetaLang} />
              <input type="hidden" name="metaComponents" value={tplMetaComponents} />

              <div className="module-footer">
                <button 
                  className="ghost btn-compact btn-cancel" 
                  type="button" 
                  onClick={closeModals} 
                  data-modal-close="true" 
                  data-loader="off"
                  title="Cerrar sin guardar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton 
                  className="primary btn-compact btn-save" 
                  type="submit"
                  pendingText="Guardando..."
                  title="Guardar plantilla de notificación"
                  aria-label="Guardar cambios"
                >
                  Guardar
                </PendingButton>
              </div>
            </form>
        </AppModal>
      ) : null}

      {editingRule ? (
        <AppModal open={Boolean(editingRule)} onClose={closeModals} title="Editar regla" maxWidth={760}>
            <form action={actions.updateRule} className="panel module" style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="environment" value={env} />
              <input type="hidden" name="ruleId" value={editingRule.id} />

              <div className="field">
                <label>Nombre</label>
                <input className="input" value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
              </div>
              <div className="field">
                <label>Trigger</label>
                <select className="select" value={ruleTrigger} onChange={(e) => setRuleTrigger(e.target.value as any)}>
                  <option value="SUBSCRIPTION_DUE">SUBSCRIPTION_DUE</option>
                  <option value="PAYMENT_LINK_CREATED">PAYMENT_LINK_CREATED</option>
                  <option value="CATALOG_LINK_CREATED">CATALOG_LINK_CREATED</option>
                  <option value="PAYMENT_APPROVED">PAYMENT_APPROVED</option>
                  <option value="PAYMENT_DECLINED">PAYMENT_DECLINED</option>
                </select>
              </div>
              <div className="field">
                <label>Plantilla</label>
                <select className="select" value={ruleTemplateId} onChange={(e) => setRuleTemplateId(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              {paymentTypeEnabled ? (
                <div className="field">
                  <label>Aplica a</label>
                  <select className="select" value={rulePaymentType} onChange={(e) => setRulePaymentType(e.target.value as any)}>
                    <option value="ANY">Todos</option>
                    <option value="PLAN">Link de pago</option>
                    <option value="SUBSCRIPTION">Suscripción</option>
                    <option value="LINK">Link de pago</option>
                  </select>
                </div>
              ) : null}
              <label className="field row">
                <span>Regla activa</span>
                <input type="checkbox" checked={ruleEnabled} onChange={(e) => setRuleEnabled(e.target.checked)} />
              </label>

              <div className="field">
                <label>Offsets</label>
                <div style={{ display: "grid", gap: 6 }}>
                  {ruleOffsets.map((o, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "140px 1fr 180px auto", gap: 6, alignItems: "end" } as any}>
                      <select className="select" value={o.direction} onChange={(e) => setRuleOffsets((prev) => prev.map((x, i) => (i === idx ? { ...x, direction: e.target.value as any } : x)))}>
                        <option value="before">Antes</option>
                        <option value="after">Después</option>
                      </select>
                      <input className="input" value={o.amount} onChange={(e) => setRuleOffsets((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} />
                      <select className="select" value={o.unit} onChange={(e) => setRuleOffsets((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value as any } : x)))} >
                        <option value="seconds">Segundos</option>
                        <option value="minutes">Minutos</option>
                        <option value="hours">Horas</option>
                        <option value="days">Días</option>
                      </select>
                      <button type="button" className="ghost" onClick={() => setRuleOffsets((prev) => prev.filter((_, i) => i !== idx))} disabled={ruleOffsets.length <= 1}>Quitar</button>
                    </div>
                  ))}
                  <button type="button" className="ghost" onClick={() => setRuleOffsets((prev) => [...prev, { direction: "after", amount: "1", unit: "hours" }])}>
                    + Agregar offset
                  </button>
                </div>
              </div>

              <label className="field row">
                <span>Enviar a hora exacta (UTC)</span>
                <input type="checkbox" checked={!!ruleAtTimeUtc} onChange={(e) => setRuleAtTimeUtc(e.target.checked ? "09:00" : "")} />
              </label>
              {ruleAtTimeUtc ? (
                <div className="field">
                  <label>Hora UTC</label>
                  <input className="input" type="time" value={ruleAtTimeUtc} onChange={(e) => setRuleAtTimeUtc(e.target.value)} />
                </div>
              ) : null}

              {ruleTrigger === "SUBSCRIPTION_DUE" ? (
                <label className="field row">
                  <span>Si falta link de pago, generar automáticamente</span>
                  <input type="checkbox" checked={ruleEnsurePaymentLink} onChange={(e) => setRuleEnsurePaymentLink(e.target.checked)} />
                </label>
              ) : null}

              <input type="hidden" name="name" value={ruleName} />
              <input type="hidden" name="trigger" value={ruleTrigger} />
              <input type="hidden" name="templateId" value={ruleTemplateId} />
              <input type="hidden" name="enabled" value={ruleEnabled ? "1" : "0"} />
              <input type="hidden" name="paymentType" value={rulePaymentType} />
              <input type="hidden" name="ensurePaymentLink" value={ruleEnsurePaymentLink ? "1" : "0"} />
              <input type="hidden" name="atTimeUtc" value={ruleAtTimeUtc} />
              {ruleOffsets.map((o, idx) => (
                <input key={idx} type="hidden" name="offsetSeconds" value={String(offsetItemToSeconds(o))} />
              ))}

              <div className="module-footer">
                <button 
                  className="ghost btn-compact btn-cancel" 
                  type="button" 
                  onClick={closeModals} 
                  data-modal-close="true" 
                  data-loader="off"
                  title="Cerrar sin guardar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton 
                  className="primary btn-compact btn-save" 
                  type="submit"
                  pendingText="Guardando..."
                  title="Guardar plantilla de notificación"
                  aria-label="Guardar cambios"
                >
                  Guardar
                </PendingButton>
              </div>
            </form>
        </AppModal>
      ) : null}
    </>
  );
}
