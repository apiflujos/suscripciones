"use client";

import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { extractProcessedParamValues } from "@suscripciones/core/services/chatwootTemplates";

export function defaultTemplateParamString(value: unknown, kind: "body" | "header" | "buttons") {
  return extractProcessedParamValues(value, kind).join("|");
}

export type ChatwootTemplate = {
  id?: string | number;
  name: string;
  language?: string;
  category?: string;
  status?: string;
  components?: any[];
};

function extractPlaceholderIndexes(value: unknown): number[] {
  if (typeof value !== "string") return [];
  const matches = value.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  return matches
    .map((match) => {
      const num = Number(match.replace(/[^\d]/g, ""));
      return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
    })
    .filter((num) => num > 0);
}

function countPlaceholderSlotsFromText(value: unknown) {
  const indexes = extractPlaceholderIndexes(value);
  return indexes.length ? Math.max(...indexes) : 0;
}

function countPlaceholderSlotsFromExample(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, countPlaceholderSlotsFromExample(item)), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (max, item) => Math.max(max, countPlaceholderSlotsFromExample(item)),
      0
    );
  }
  return 0;
}

function countExampleValueSlots(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((max, item) => {
    if (Array.isArray(item)) return Math.max(max, item.filter((entry) => entry != null && String(entry).trim() !== "").length);
    if (item && typeof item === "object") return Math.max(max, countExampleValueSlots(Object.values(item)));
    return max;
  }, 0);
}

function buttonRequiresParameter(button: any) {
  const hasPlaceholder = countPlaceholderSlotsFromText(button?.url) > 0;
  const hasExample = countPlaceholderSlotsFromExample(button?.example) > 0;
  return hasPlaceholder || hasExample;
}

export function WaTemplateFields({
  templates,
  defaultName,
  defaultLang,
  defaultParams,
  defaultHeaderParams,
  defaultButtonParams,
  variables,
  buttonVariables,
  onSync,
  syncing,
  syncError
}: {
  templates: ChatwootTemplate[];
  defaultName?: string;
  defaultLang?: string;
  defaultParams?: string;
  defaultHeaderParams?: string;
  defaultButtonParams?: string;
  variables: Array<{ label: string; value: string; recommended?: boolean }>;
  buttonVariables: Array<{ label: string; value: string; recommended?: boolean }>;
  onSync?: () => void;
  syncing?: boolean;
  syncError?: string;
}) {
  const [name, setName] = useState(defaultName || "");
  const [lang, setLang] = useState(defaultLang || "es");
  const [bodyParams, setBodyParams] = useState<string[]>(
    defaultParams ? defaultParams.split("|").map((p) => p.trim()) : []
  );
  const [headerParams, setHeaderParams] = useState<string[]>(
    defaultHeaderParams ? defaultHeaderParams.split("|").map((p) => p.trim()) : []
  );
  const [buttonParams, setButtonParams] = useState<string[]>(
    defaultButtonParams ? defaultButtonParams.split("|").map((p) => p.trim()) : []
  );

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.name === name && String(t.language || "es") === String(lang || "es")) || null;
  }, [templates, name, lang]);

  const bodyParamCount = useMemo(() => {
    const comps = selectedTemplate?.components || [];
    const body = comps.find((c: any) => String(c?.type || "").toUpperCase() === "BODY") as any;
    if (!body) return 0;
    const countByText = countPlaceholderSlotsFromText(body?.text);
    const countByExample = Math.max(
      countPlaceholderSlotsFromExample(body?.example),
      countExampleValueSlots(body?.example?.body_text)
    );
    return Math.max(countByText, countByExample, bodyParams.length);
  }, [selectedTemplate, bodyParams.length]);

  const headerParamCount = useMemo(() => {
    const comps = selectedTemplate?.components || [];
    const header = comps.find((c: any) => String(c?.type || "").toUpperCase() === "HEADER") as any;
    if (!header) return 0;
    const fmt = String(header?.format || header?.format_type || "").toUpperCase();
    if (fmt && fmt !== "TEXT") return 0;
    const countByText = countPlaceholderSlotsFromText(header?.text);
    const countByExample = Math.max(
      countPlaceholderSlotsFromExample(header?.example),
      Array.isArray(header?.example?.header_text)
        ? header.example.header_text.filter((entry: unknown) => entry != null && String(entry).trim() !== "").length
        : 0
    );
    return Math.max(countByText, countByExample, headerParams.length);
  }, [selectedTemplate, headerParams.length]);

  const buttonParamCount = useMemo(() => {
    const comps = selectedTemplate?.components || [];
    const buttons = comps.find((c: any) => String(c?.type || "").toUpperCase() === "BUTTONS") as any;
    if (!buttons || !Array.isArray(buttons?.buttons)) return 0;
    const urlButtons = buttons.buttons.filter((b: any) => String(b?.type || "").toUpperCase() === "URL");
    const inferred = urlButtons.reduce((count: number, button: any) => {
      return count + (buttonRequiresParameter(button) ? 1 : 0);
    }, 0);
    return Math.max(inferred, buttonParams.length);
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

  const templateButtons = useMemo(() => {
    const comps = selectedTemplate?.components || [];
    const buttons = comps.find((c: any) => String(c?.type || "").toUpperCase() === "BUTTONS") as any;
    if (!buttons || !Array.isArray(buttons?.buttons)) return [] as Array<{ type: string; text: string; url?: string | null; parameterIndex: number | null }>;
    let dynamicParamIndex = 0;
    return buttons.buttons.map((button: any) => {
      const requiresParameter = String(button?.type || "").toUpperCase() === "URL" && buttonRequiresParameter(button);
      const parameterIndex = requiresParameter ? dynamicParamIndex++ : null;
      return {
      type: String(button?.type || "").toUpperCase(),
      text: String(button?.text || button?.label || "Botón").trim() || "Botón",
      url: button?.url ? String(button.url) : null,
      parameterIndex
      };
    });
  }, [selectedTemplate]);

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

  return (
    <>
      <div className="field" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <label htmlFor="notif-wa-template" style={{ margin: 0 }}>Plantillas disponibles</label>
        {onSync ? (
          <button className="ghost btn-compact" type="button" onClick={onSync} data-loader="off">
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </button>
        ) : null}
      </div>
      {templates.length ? (
        <div className="field">
          <select id="notif-wa-template" className="select select-compact" value={name ? `${name}::${lang}` : ""} onChange={(e) => onSelect(e.target.value)}>
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
      <input type="hidden" name="waTemplateName" value={name} />
      <input type="hidden" name="waLanguage" value={lang} />
      <div className="field">
        <label htmlFor="notif-wa-preview">Mensaje</label>
        <textarea id="notif-wa-preview" className="input input-compact" rows={6} readOnly value={templatePreview || templateBody} />
      </div>
      {templateButtons.length ? (
        <div className="field">
          <label>Botones detectados</label>
          <div
            style={{
              display: "grid",
              gap: 8,
              padding: 12,
              border: "1px solid var(--stroke)",
              borderRadius: 12,
              background: "var(--panel)"
            }}
          >
            {templateButtons.map((button, idx) => {
              const mappedValue = button.parameterIndex != null ? buttonParams[button.parameterIndex] || "" : "";
              return (
                <div
                  key={`preview-button-${idx}`}
                  style={{
                    display: "grid",
                    gap: 4,
                    padding: "10px 12px",
                    border: "1px solid var(--stroke)",
                    borderRadius: 10,
                    background: "var(--card)"
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{button.text}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {button.type === "URL"
                      ? mappedValue
                        ? `Variable del botón: ${mappedValue}`
                        : "Botón URL: requiere seleccionar una variable"
                      : `Botón ${button.type || "estático"}: no requiere variable`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
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
                        {v.recommended ? `Recomendada · ${v.label}` : v.label}
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
                        {v.recommended ? `Recomendada · ${v.label}` : v.label}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            ) : null}
            {buttonParamCount ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div className="muted">Botones</div>
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
                    {buttonVariables.map((v) => (
                      <option key={`b-${idx}-${v.value}`} value={v.value}>
                        {v.recommended ? `Recomendada · ${v.label}` : v.label}
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
        <input type="hidden" name="waParams" value={bodyParams.join("|")} />
        <input type="hidden" name="waBodyParams" value={bodyParams.join("|")} />
        <input type="hidden" name="waHeaderParams" value={headerParams.join("|")} />
        <input type="hidden" name="waButtonParams" value={buttonParams.join("|")} />
      </div>
    </>
  );
}
