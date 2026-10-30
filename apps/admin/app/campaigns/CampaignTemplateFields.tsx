"use client";

import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "../ui/HelpTip";

export type ChatwootTemplate = {
  name: string;
  language?: string;
  components?: any[];
};

export type WaTemplateState = {
  name: string;
  lang: string;
  bodyParams: string[];
  headerParams: string[];
  buttonParams: string[];
};

export function CampaignTemplateFields({
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
  onChange: (state: WaTemplateState) => void;
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
        <label htmlFor="campaign-wa-template" style={{ margin: 0 }}>Plantillas disponibles</label>
        {onSync ? (
          <button className="ghost btn-compact" type="button" onClick={onSync} data-loader="off" disabled={syncing}>
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </button>
        ) : null}
      </div>
      {templates.length ? (
        <div className="field">
          <select id="campaign-wa-template" className="select select-compact" defaultValue="" onChange={(e) => onSelect(e.target.value)}>
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
        <div className="field-hint ui-alert-warn">
          No hay plantillas disponibles. Sincroniza para cargarlas.
          {syncError && String(syncError).includes("chatwoot_not_configured") ? (
            <div style={{ marginTop: 6 }}>
              <a className="ghost btn-compact" href="/settings?tab=connections&open=central">
                Configurar Chatwoot
              </a>
            </div>
          ) : null}
        </div>
      )}
      <div className="field">
        <label htmlFor="campaign-wa-preview">Mensaje</label>
        <textarea id="campaign-wa-preview" className="input input-compact" rows={6} readOnly value={templatePreview || templateBody} />
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
                <div className="muted">Mensaje</div>
                {Array.from({ length: bodyParamCount }).map((_, idx) => (
                  <select
                    key={`param-body-${idx}`}
                    aria-label={`Variable del mensaje {{${idx + 1}}}`}
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
                <div className="muted">Encabezado</div>
                {Array.from({ length: headerParamCount }).map((_, idx) => (
                  <select
                    key={`param-header-${idx}`}
                    aria-label={`Variable del encabezado {{${idx + 1}}}`}
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
                    aria-label={`Variable del botón ${idx + 1}`}
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
