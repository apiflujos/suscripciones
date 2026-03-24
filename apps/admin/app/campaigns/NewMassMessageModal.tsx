"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";

type SmartList = { id: string; name: string };
type MessageOption = { key: string; label: string; content: string };

type ChatwootTemplate = {
  name: string;
  language?: string;
  components?: any[];
};

const MESSAGE_VARIABLES = [
  { label: "Ciclo actual", value: "{{subscription.currentCycle}}" },
  { label: "Correo de la empresa", value: "{{company.email}}" },
  { label: "Correo del contacto", value: "{{contact.email}}" },
  { label: "Correo electrónico", value: "{{customer.email}}" },
  { label: "Dirección", value: "{{customer.metadata.address}}" },
  { label: "Enlace de catálogo", value: "{{catalog.url}}" },
  { label: "Enlace de débito automático", value: "{{tokenization.url}}" },
  { label: "Enlace de pago", value: "{{payment.checkoutUrl}}" },
  { label: "Estado de la suscripción", value: "{{subscription.status}}" },
  { label: "Estado del pago", value: "{{payment.status}}" },
  { label: "Fecha de corte", value: "{{subscription.currentPeriodEndAt}}" },
  { label: "Fecha de creación del pago", value: "{{payment.createdAt}}" },
  { label: "Fecha de fallo del pago", value: "{{payment.failedAt}}" },
  { label: "Fecha de inicio del ciclo", value: "{{subscription.currentPeriodStartAt}}" },
  { label: "Fecha de pago", value: "{{payment.paidAt}}" },
  { label: "Frecuencia (cantidad)", value: "{{plan.intervalCount}}" },
  { label: "Frecuencia (unidad)", value: "{{plan.intervalUnit}}" },
  { label: "Moneda del pago", value: "{{payment.currency}}" },
  { label: "Moneda del producto", value: "{{plan.currency}}" },
  { label: "Monto del pago (pesos)", value: "{{payment.amountInPesos}}" },
  { label: "Nombre completo", value: "{{customer.name}}" },
  { label: "Nombre de la empresa", value: "{{company.name}}" },
  { label: "Nombre del contacto", value: "{{contact.name}}" },
  { label: "Nombre del producto", value: "{{plan.name}}" },
  { label: "Precio del producto (pesos)", value: "{{plan.priceInPesos}}" },
  { label: "Referencia", value: "{{payment.reference}}" },
  { label: "Teléfono", value: "{{customer.phone}}" },
  { label: "Teléfono de la empresa", value: "{{company.phone}}" },
  { label: "Teléfono del contacto", value: "{{contact.phone}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

function insertAtCursor(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  el.value = `${before}${text}${after}`;
  const nextPos = start + text.length;
  el.setSelectionRange(nextPos, nextPos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}

function autoResizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function WaTemplateFields({
  templates,
  onSync,
  syncing,
  syncError,
  onChange
}: {
  templates: ChatwootTemplate[];
  onSync?: () => void;
  syncing?: boolean;
  syncError?: string;
  onChange: (state: { name: string; lang: string; bodyParams: string[]; headerParams: string[]; buttonParams: string[] }) => void;
}) {
  const [name, setName] = useState("");
  const [lang, setLang] = useState("es");
  const [bodyParams, setBodyParams] = useState<string[]>([]);
  const [headerParams, setHeaderParams] = useState<string[]>([]);
  const [buttonParams, setButtonParams] = useState<string[]>([]);

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.name === name && String(t.language || "es") === String(lang || "es")) || null;
  }, [templates, name, lang]);

  const bodyParamCount = useMemo(() => {
    const comps = selectedTemplate?.components || [];
    const body = comps.find((c: any) => String(c?.type || "").toUpperCase() === "BODY") as any;
    if (!body) return 0;
    const text = String(body?.text || "");
    const matches = text.match(/\{\{\d+\}\}/g) || [];
    const countByText = matches.length;
    const countByExample = Array.isArray(body?.example?.body_text) ? (body.example.body_text[0]?.length || 0) : 0;
    return Math.max(countByText, countByExample, bodyParams.length);
  }, [selectedTemplate, bodyParams.length]);

  const headerParamCount = useMemo(() => {
    const comps = selectedTemplate?.components || [];
    const header = comps.find((c: any) => String(c?.type || "").toUpperCase() === "HEADER") as any;
    if (!header) return 0;
    const fmt = String(header?.format || header?.format_type || "").toUpperCase();
    if (fmt && fmt !== "TEXT") return 0;
    const text = String(header?.text || "");
    const matches = text.match(/\{\{\d+\}\}/g) || [];
    const countByText = matches.length;
    const countByExample = Array.isArray(header?.example?.header_text) ? header.example.header_text.length : 0;
    return Math.max(countByText, countByExample, headerParams.length);
  }, [selectedTemplate, headerParams.length]);

  const buttonParamCount = useMemo(() => {
    const comps = selectedTemplate?.components || [];
    const buttons = comps.find((c: any) => String(c?.type || "").toUpperCase() === "BUTTONS") as any;
    if (!buttons || !Array.isArray(buttons?.buttons)) return 0;
    const urlButtons = buttons.buttons.filter((b: any) => String(b?.type || "").toUpperCase() === "URL");
    return Math.max(urlButtons.length, buttonParams.length);
  }, [selectedTemplate, buttonParams.length]);

  const templateBody = useMemo(() => {
    const comps = selectedTemplate?.components || [];
    const body = comps.find((c: any) => String(c?.type || "").toUpperCase() === "BODY") as any;
    const text = String(body?.text || "");
    if (text) return text;
    const fallback = comps
      .map((c: any) => String(c?.text || "").trim())
      .filter(Boolean)
      .join("\n");
    return fallback || "";
  }, [selectedTemplate]);

  const templatePreview = useMemo(() => {
    if (!templateBody) return "";
    return templateBody.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
      const idx = Math.max(1, Number(n)) - 1;
      const val = bodyParams[idx];
      return val ? String(val) : `{{${n}}}`;
    });
  }, [templateBody, bodyParams]);

  const ensureLength = (values: string[], count: number) => {
    if (!count) return [];
    const next = values.slice(0, count);
    while (next.length < count) next.push("");
    return next;
  };

  const onSelect = (value: string) => {
    if (!value) return;
    const [tplName, tplLang] = value.split("::");
    setName(tplName || "");
    setLang(tplLang || "es");
  };

  useEffect(() => {
    if (!selectedTemplate) return;
    setBodyParams((prev) => ensureLength(prev, bodyParamCount));
    setHeaderParams((prev) => ensureLength(prev, headerParamCount));
    setButtonParams((prev) => ensureLength(prev, buttonParamCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate, bodyParamCount, headerParamCount, buttonParamCount]);

  useEffect(() => {
    onChange({ name, lang, bodyParams, headerParams, buttonParams });
  }, [name, lang, bodyParams, headerParams, buttonParams, onChange]);

  return (
    <>
      <div className="field" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <label style={{ margin: 0 }}>Plantillas disponibles</label>
        {onSync ? (
          <button className="ghost btn-compact" type="button" onClick={onSync} data-loader="off">
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </button>
        ) : null}
      </div>
      {templates.length ? (
        <div className="field">
          <select className="select select-compact" defaultValue="" onChange={(e) => onSelect(e.target.value)}>
            <option value="">Selecciona una plantilla</option>
            {templates.map((t) => (
              <option key={`${t.name}:${t.language || "es"}`} value={`${t.name}::${t.language || "es"}`}>
                {t.name} · {t.language || "es"}
              </option>
            ))}
          </select>
          {syncError ? <div className="field-hint" style={{ color: "var(--danger)" }}>{syncError}</div> : null}
        </div>
      ) : (
        <div className="field-hint">No hay plantillas disponibles. Sincroniza para cargarlas.</div>
      )}
      <div className="field">
        <label>Mensaje</label>
        <textarea className="input input-compact" rows={6} readOnly value={templatePreview || templateBody} />
      </div>
      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>Parámetros</span>
          <HelpTip text="Se abren según la plantilla seleccionada. Valores para {{1}}, {{2}}, {{3}}..." />
        </label>
        {bodyParamCount || headerParamCount || buttonParamCount ? (
          <div style={{ display: "grid", gap: 10 }}>
            {bodyParamCount ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div className="muted">Body</div>
                {Array.from({ length: bodyParamCount }).map((_, idx) => (
                  <select
                    key={`param-body-${idx}`}
                    className="select select-compact"
                    value={bodyParams[idx] || ""}
                    onChange={(e) => {
                      const next = bodyParams.slice();
                      next[idx] = e.target.value;
                      setBodyParams(next);
                    }}
                  >
                    <option value="">{`{{${idx + 1}}} · Selecciona variable`}</option>
                    {MESSAGE_VARIABLES.map((v) => (
                      <option key={`${idx}-${v.value}`} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            ) : null}
            {headerParamCount ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div className="muted">Header</div>
                {Array.from({ length: headerParamCount }).map((_, idx) => (
                  <select
                    key={`param-header-${idx}`}
                    className="select select-compact"
                    value={headerParams[idx] || ""}
                    onChange={(e) => {
                      const next = headerParams.slice();
                      next[idx] = e.target.value;
                      setHeaderParams(next);
                    }}
                  >
                    <option value="">{`{{${idx + 1}}} · Selecciona variable`}</option>
                    {MESSAGE_VARIABLES.map((v) => (
                      <option key={`h-${idx}-${v.value}`} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            ) : null}
            {buttonParamCount ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div className="muted">Botones (URL)</div>
                {Array.from({ length: buttonParamCount }).map((_, idx) => (
                  <select
                    key={`param-button-${idx}`}
                    className="select select-compact"
                    value={buttonParams[idx] || ""}
                    onChange={(e) => {
                      const next = buttonParams.slice();
                      next[idx] = e.target.value;
                      setButtonParams(next);
                    }}
                  >
                    <option value="">{`Botón ${idx + 1} · Selecciona variable`}</option>
                    {MESSAGE_VARIABLES.map((v) => (
                      <option key={`b-${idx}-${v.value}`} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="field-hint">Esta plantilla no requiere variables.</div>
        )}
      </div>
    </>
  );
}

export function NewMassMessageModal({
  csrfToken,
  returnTo,
  lists,
  messageOptions,
  action
}: {
  csrfToken: string;
  returnTo: string;
  lists: SmartList[];
  messageOptions: MessageOption[];
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [templateKind, setTemplateKind] = useState<"TEXT" | "WHATSAPP_TEMPLATE">("TEXT");
  const [presetKey, setPresetKey] = useState<string>(messageOptions[0]?.key || "custom");
  const [message, setMessage] = useState<string>(messageOptions[0]?.content || "");
  const [supportContent, setSupportContent] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [waTemplates, setWaTemplates] = useState<ChatwootTemplate[]>([]);
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState("");
  const [waState, setWaState] = useState({ name: "", lang: "es", bodyParams: [] as string[], headerParams: [] as string[], buttonParams: [] as string[] });
  const [smartListId, setSmartListId] = useState("");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceSample, setAudienceSample] = useState<Array<{ id: string; name?: string; email?: string; phone?: string }>>([]);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState("");
  const [audienceApproved, setAudienceApproved] = useState(false);
  const lastFieldRef = useRef<HTMLTextAreaElement | null>(null);

  const presetOptions = useMemo(() => {
    const base = messageOptions || [];
    return [{ key: "custom", label: "Personalizado", content: "" }, ...base];
  }, [messageOptions]);

  const loadWaTemplates = useCallback(async () => {
    setWaLoading(true);
    setWaError("");
    try {
      const res = await fetch("/admin/comms?op=whatsapp_templates", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok && Array.isArray(json.templates)) {
        setWaTemplates(json.templates);
      } else {
        setWaTemplates([]);
        setWaError(String(json?.error || "No se pudieron cargar las plantillas"));
      }
    } catch (err: any) {
      setWaTemplates([]);
      setWaError(String(err?.message || "No se pudieron cargar las plantillas"));
    } finally {
      setWaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setWizardStep(1);
    setAudienceApproved(false);
    setAudienceCount(null);
    setAudienceSample([]);
    setAudienceError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (templateKind === "WHATSAPP_TEMPLATE" && !waTemplates.length) {
      loadWaTemplates();
    }
  }, [open, templateKind, waTemplates.length, loadWaTemplates]);

  const handlePresetChange = (nextKey: string) => {
    setPresetKey(nextKey);
    const selected = presetOptions.find((p) => p.key === nextKey);
    if (selected && selected.key !== "custom") {
      setMessage(selected.content || "");
    }
  };

  const onPickValue = (value: string) => {
    if (lastFieldRef.current) insertAtCursor(lastFieldRef.current, value);
    setPickerOpen(false);
  };

  const loadAudiencePreview = useCallback(async (id: string) => {
    const trimmed = String(id || "").trim();
    if (!trimmed) {
      setAudienceCount(null);
      setAudienceSample([]);
      setAudienceError("");
      return;
    }
    setAudienceLoading(true);
    setAudienceError("");
    setAudienceApproved(false);
    try {
      const res = await fetch(`/admin/comms/smart-lists/${trimmed}/preview`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (res.ok && json && typeof json.count === "number") {
        setAudienceCount(json.count);
        setAudienceSample(Array.isArray(json.sample) ? json.sample : []);
      } else {
        setAudienceCount(null);
        setAudienceSample([]);
        setAudienceError(String(json?.error || "No se pudo cargar la audiencia"));
      }
    } catch (err: any) {
      setAudienceCount(null);
      setAudienceSample([]);
      setAudienceError(String(err?.message || "No se pudo cargar la audiencia"));
    } finally {
      setAudienceLoading(false);
    }
  }, []);

  return (
    <>
      <button className="primary" type="button" onClick={() => setOpen(true)} data-modal="true" data-loader="off">
        Nueva campaña
      </button>
      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 900 }}>
            <div className="panel-header">
              <strong>Nueva campaña</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <div className="modal-body">
              <form action={action} className="panel module" style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="templateKind" value={templateKind} />
                <input type="hidden" name="waTemplateName" value={waState.name} />
                <input type="hidden" name="waLanguage" value={waState.lang} />
                <input type="hidden" name="waBodyParams" value={waState.bodyParams.join("|")} />
                <input type="hidden" name="waHeaderParams" value={waState.headerParams.join("|")} />
                <input type="hidden" name="waButtonParams" value={waState.buttonParams.join("|")} />

                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" required placeholder="Ej: Recordatorio cartera marzo" />
                </div>

                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Filtro inteligente (audiencia)</span>
                    <HelpTip text="Selecciona la lista inteligente de contactos a la que se enviará el mensaje." />
                  </label>
                  <select
                    className="select"
                    name="smartListId"
                    required
                    value={smartListId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSmartListId(next);
                      loadAudiencePreview(next);
                    }}
                  >
                    <option value="">Selecciona una lista</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  {audienceLoading ? <div className="field-hint">Calculando audiencia...</div> : null}
                  {audienceError ? <div className="field-hint" style={{ color: "var(--danger)" }}>{audienceError}</div> : null}
                  {audienceCount !== null && !audienceLoading ? (
                    <div className="card cardPad" style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <strong>Resumen de audiencia</strong>
                        <span className="pill pill-muted">{audienceCount} contactos</span>
                      </div>
                      {audienceSample.length ? (
                        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                          {audienceSample.map((c) => (
                            <div key={c.id} className="muted" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <span>{c.name || "Contacto"}</span>
                              {c.email ? <span>· {c.email}</span> : null}
                              {c.phone ? <span>· {c.phone}</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="field-hint" style={{ marginTop: 6 }}>
                          Esta lista no tiene contactos.
                        </div>
                      )}
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                        <input
                          type="checkbox"
                          checked={audienceApproved}
                          onChange={(e) => setAudienceApproved(e.target.checked)}
                          disabled={!audienceCount || audienceCount <= 0}
                        />
                        <span>Aprobar envío a esta audiencia</span>
                      </label>
                    </div>
                  ) : null}
                </div>

                {wizardStep === 1 ? (
                  <div className="field">
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Paso 1: tipo de envío</span>
                      <HelpTip text="Selecciona si usarás un mensaje libre o una plantilla de WhatsApp." />
                    </label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="ghost btn-compact"
                        onClick={() => {
                          setTemplateKind("TEXT");
                          setWizardStep(2);
                        }}
                        data-loader="off"
                      >
                        Mensaje
                      </button>
                      <button
                        type="button"
                        className="ghost btn-compact"
                        onClick={() => {
                          setTemplateKind("WHATSAPP_TEMPLATE");
                          setWizardStep(2);
                        }}
                        data-loader="off"
                      >
                        Plantilla WhatsApp
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="field row" style={{ justifyContent: "space-between" }}>
                    <div className="muted">Tipo: {templateKind === "WHATSAPP_TEMPLATE" ? "Plantilla" : "Mensaje"}</div>
                    <button className="ghost btn-compact" type="button" onClick={() => setWizardStep(1)} data-loader="off">
                      Cambiar tipo
                    </button>
                  </div>
                )}

                {wizardStep === 2 && templateKind === "TEXT" ? (
                  <>
                    <div className="field">
                      <label>Mensaje base</label>
                      <select className="select" value={presetKey} onChange={(e) => handlePresetChange(e.target.value)}>
                        {presetOptions.map((op) => (
                          <option key={op.key} value={op.key}>
                            {op.label}
                          </option>
                        ))}
                      </select>
                      <div className="field-hint">Puedes iniciar con un mensaje de Notificaciones y personalizarlo.</div>
                    </div>
                    <div className="field">
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>Mensaje</span>
                        <HelpTip text="Usa variables del sistema como {{customer.name}}, {{payment.checkoutUrl}}." />
                      </label>
                      <textarea
                        className="input"
                        name="content"
                        rows={4}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onFocus={(e) => (lastFieldRef.current = e.target)}
                        onInput={(e) => autoResizeTextarea(e.currentTarget)}
                        placeholder="Escribe el mensaje..."
                        required
                      />
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button type="button" className="ghost btn-compact" onClick={() => setPickerOpen(true)} data-loader="off">
                          Variables
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}

                {wizardStep === 2 && templateKind === "WHATSAPP_TEMPLATE" ? (
                  <>
                    <WaTemplateFields
                      templates={waTemplates}
                      onSync={loadWaTemplates}
                      syncing={waLoading}
                      syncError={waError}
                      onChange={setWaState}
                    />
                    <div className="field">
                      <label>Texto de apoyo (opcional)</label>
                      <textarea
                        className="input"
                        name="content"
                        rows={3}
                        value={supportContent}
                        onChange={(e) => setSupportContent(e.target.value)}
                        placeholder="Mensaje visible junto a la plantilla (opcional)."
                      />
                    </div>
                  </>
                ) : null}

                {wizardStep === 2 ? (
                  <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button className="ghost" type="button" onClick={() => setOpen(false)} data-loader="off">
                      Cancelar
                    </button>
                    <PendingButton className="primary" type="submit" pendingText="Guardando..." disabled={!audienceApproved}>
                      Guardar campaña
                    </PendingButton>
                  </div>
                ) : null}
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {pickerOpen ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 680 }}>
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Variables</h3>
              <button type="button" className="ghost modal-close" onClick={() => setPickerOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <div className="panel module" style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {MESSAGE_VARIABLES.map((item) => (
                  <button key={item.value} type="button" className="ghost" onClick={() => onPickValue(item.value)} style={{ minHeight: 32 }} data-loader="off">
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
