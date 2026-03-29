"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { FilterButton } from "../ui/FilterButton";

type SmartView = { id: string; name: string; visibility: "ORG" | "PRIVATE"; type: "DYNAMIC" | "STATIC"; filters?: any };

type ChatwootTemplate = {
  name: string;
  language?: string;
  components?: any[];
};


const MESSAGE_VARIABLES = [
  { label: "Nombre completo", value: "{{customer.name}}" },
  { label: "Correo electrónico", value: "{{customer.email}}" },
  { label: "Teléfono", value: "{{customer.phone}}" },
  { label: "Nombre del producto", value: "{{plan.name}}" },
  { label: "Precio del producto (pesos)", value: "{{plan.priceInPesos}}" },
  { label: "Moneda del producto", value: "{{plan.currency}}" },
  { label: "Monto del pago (pesos)", value: "{{payment.amountInPesos}}" },
  { label: "Moneda del pago", value: "{{payment.currency}}" },
  { label: "Estado del pago", value: "{{payment.status}}" },
  { label: "Referencia", value: "{{payment.reference}}" },
  { label: "Estado de la suscripción", value: "{{subscription.status}}" },
  { label: "Ciclo actual", value: "{{subscription.currentCycle}}" },
  { label: "Fecha de inicio del ciclo", value: "{{subscription.currentPeriodStartAt}}" },
  { label: "Fecha de corte", value: "{{subscription.currentPeriodEndAt}}" },
  { label: "Fecha de pago", value: "{{payment.paidAt}}" },
  { label: "Fecha de creación del pago", value: "{{payment.createdAt}}" },
  { label: "Fecha de fallo del pago", value: "{{payment.failedAt}}" },
  { label: "Recurrencia · cada (cantidad)", value: "{{plan.intervalCount}}" },
  { label: "Recurrencia · unidad", value: "{{plan.intervalUnit}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" },
  { label: "Link público (Automático · Plan)", value: "{{checkoutPublicUrl.AUTO_PLAN}}" },
  { label: "Link público (Automático · Suscripción)", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" },
  { label: "Link público (Automático · Catálogo)", value: "{{checkoutPublicUrl.AUTO_CART}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

function WaTemplateFields({
  templates,
  variables,
  buttonVariables,
  onSync,
  syncing,
  syncError,
  onChange
}: {
  templates: ChatwootTemplate[];
  variables: Array<{ label: string; value: string }>;
  buttonVariables?: Array<{ label: string; value: string }>;
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
                    {variables.map((v) => (
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
                    {variables.map((v) => (
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
                    {(buttonVariables || variables).map((v) => (
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
  views,
  tenantId,
  action
}: {
  csrfToken: string;
  returnTo: string;
  views: SmartView[];
  tenantId?: string | null;
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [supportContent, setSupportContent] = useState<string>("");
  const [waTemplates, setWaTemplates] = useState<ChatwootTemplate[]>([]);
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState("");
  const [waState, setWaState] = useState({ name: "", lang: "es", bodyParams: [] as string[], headerParams: [] as string[], buttonParams: [] as string[] });
  const [smartViewId, setSmartViewId] = useState("");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState("");
  const [audienceApproved, setAudienceApproved] = useState(false);
  const templateKind: "WHATSAPP_TEMPLATE" = "WHATSAPP_TEMPLATE";

  const isFormValid = useMemo(() => {
    return audienceApproved && audienceCount !== null && audienceCount > 0 && waState.name !== "";
  }, [audienceApproved, audienceCount, waState.name]);

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
    setAudienceApproved(false);
    setAudienceCount(null);
    setAudienceError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!waTemplates.length) {
      loadWaTemplates();
    }
  }, [open, waTemplates.length, loadWaTemplates]);

  const loadAudiencePreview = useCallback(async (id: string) => {
    const trimmed = String(id || "").trim();
    if (!trimmed) {
      setAudienceCount(null);
      setAudienceError("");
      return;
    }
    setAudienceLoading(true);
    setAudienceError("");
    setAudienceApproved(false);
    try {
      const res = await fetch(`/admin/smart-views/customers/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewId: trimmed, ...(tenantId ? { tenantId } : {}) })
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && typeof json.count === "number") {
        setAudienceCount(json.count);
      } else {
        setAudienceCount(null);
        setAudienceError(String(json?.error || "No se pudo cargar la audiencia"));
      }
    } catch (err: any) {
      setAudienceCount(null);
      setAudienceError(String(err?.message || "No se pudo cargar la audiencia"));
    } finally {
      setAudienceLoading(false);
    }
  }, [tenantId]);

  const allVariables = useMemo(() => [...MESSAGE_VARIABLES], []);
  const buttonVariables = useMemo(
    () => [{ label: "Checkout público (Automático)", value: "{{checkoutPublicToken.AUTO}}" }],
    []
  );

  return (
    <>
      <button className="primary" type="button" onClick={() => setOpen(true)} data-modal="true" data-loader="off">
        Nueva campaña
      </button>
      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel campaignsModal" style={{ maxWidth: 900 }}>
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
                    <HelpTip text="Selecciona un filtro para definir a quiénes llegará esta campaña." />
                  </label>
                  
                  {/* Selector de filtros inteligentes */}
                  <select
                    className="select"
                    name="smartViewId"
                    required
                    value={smartViewId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSmartViewId(next);
                      loadAudiencePreview(next);
                    }}
                    style={{ marginBottom: 8 }}
                  >
                    <option value="">Selecciona un filtro...</option>
                    {views.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {v.visibility === "PRIVATE" ? "(Privada)" : ""}
                      </option>
                    ))}
                  </select>
                  
                  <div style={{ marginBottom: 8 }}>
                    <FilterButton scope="customers" label="Crear nuevo filtro" fullWidth />
                  </div>
                  
                  {audienceLoading ? <div className="field-hint">Calculando audiencia...</div> : null}
                  {audienceError ? <div className="field-hint" style={{ color: "var(--danger)" }}>{audienceError}</div> : null}
                  {audienceCount !== null && !audienceLoading ? (
                    <div className="card cardPad" style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <strong>Audiencia seleccionada</strong>
                        <span className="pill pill-ok">{audienceCount} contactos</span>
                      </div>
                      {audienceCount <= 0 ? (
                        <div className="field-hint" style={{ marginTop: 6, color: "var(--danger)" }}>
                          ⚠️ Esta audiencia no tiene contactos. Selecciona otro filtro.
                        </div>
                      ) : (
                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                          <input
                            type="checkbox"
                            checked={audienceApproved}
                            onChange={(e) => setAudienceApproved(e.target.checked)}
                            disabled={!audienceCount || audienceCount <= 0}
                          />
                          <span>✓ Confirmo que esta es la audiencia correcta para la campaña</span>
                        </label>
                      )}
                    </div>
                  ) : null}
                </div>

                <WaTemplateFields
                  templates={waTemplates}
                  variables={allVariables}
                  buttonVariables={buttonVariables}
                  onSync={loadWaTemplates}
                  syncing={waLoading}
                  syncError={waError}
                  onChange={setWaState}
                />
                {!waState.name ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    Debes seleccionar una plantilla de WhatsApp.
                  </div>
                ) : null}
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>Texto de apoyo (opcional)</span>
                    <HelpTip text="Mensaje adicional que se muestra junto a la plantilla de WhatsApp. Puede usarse para contexto extra o enlaces." />
                  </label>
                  <textarea
                    className="input"
                    name="content"
                    rows={3}
                    value={supportContent}
                    onChange={(e) => setSupportContent(e.target.value)}
                    placeholder="Mensaje visible junto a la plantilla (opcional)."
                  />
                </div>

                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button className="ghost" type="button" onClick={() => setOpen(false)} data-loader="off">
                    Cancelar
                  </button>
                  <PendingButton className="primary" type="submit" pendingText="Guardando..." disabled={!isFormValid}>
                    Guardar campaña
                  </PendingButton>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
