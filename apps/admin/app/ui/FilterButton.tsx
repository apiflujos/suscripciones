"use client";

import { useState } from "react";

type SmartField = {
  key: string;
  label: string;
  group: string;
  type: "text" | "number" | "date" | "boolean" | "enum" | "phone" | "money";
  operators: string[];
  options?: Array<{ value: string; label: string }>;
};

type Rule =
  | { field: string; op: string; value?: any }
  | { op: "and" | "or"; rules: Rule[] };

export function FilterButton({
  scope,
  baseParams,
  initialFields,
  compactInline
}: {
  scope?: string;
  baseParams?: Record<string, string>;
  initialFields?: SmartField[];
  compactInline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<Rule>({ op: "and", rules: [] });
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"ORG" | "PRIVATE">("ORG");
  const [type, setType] = useState<"DYNAMIC" | "STATIC">("DYNAMIC");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<SmartField[]>(() => (Array.isArray(initialFields) ? initialFields : []));
  const [fieldsLoaded, setFieldsLoaded] = useState(false);

  // Cargar campos si es necesario
  const ensureFieldsLoaded = async () => {
    if (fieldsLoaded || !scope) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/smart-views/${encodeURIComponent(scope)}/fields`, { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudieron cargar los campos");
      const json = await res.json();
      if (Array.isArray(json.fields)) {
        setFields(json.fields);
        setFieldsLoaded(true);
        // Agregar regla inicial si está vacío
        if (root.rules.length === 0 && json.fields.length > 0) {
          const firstField = json.fields[0];
          const firstOp = firstField.operators?.[0] || "equals";
          setRoot({ op: "and", rules: [{ field: firstField.key, op: firstOp, value: "" }] });
        }
      }
    } catch (err: any) {
      setError(String(err?.message || "Error al cargar campos"));
    } finally {
      setLoading(false);
    }
  };

  const addRule = () => {
    if (fields.length === 0) return;
    const firstField = fields[0];
    const firstOp = firstField.operators?.[0] || "equals";
    setRoot({ op: "and", rules: [...root.rules, { field: firstField.key, op: firstOp, value: "" }] });
  };

  const updateRule = (index: number, next: Rule) => {
    if (!("rules" in root)) return;
    const rules = [...root.rules];
    rules[index] = next;
    setRoot({ ...root, rules });
  };

  const removeRule = (index: number) => {
    if (!("rules" in root)) return;
    const rules = root.rules.filter((_, i) => i !== index);
    setRoot({ ...root, rules });
  };

  const saveFilter = async () => {
    if (!name.trim()) {
      setError("El nombre del filtro es obligatorio");
      return;
    }
    if (!("rules" in root) || root.rules.length === 0) {
      setError("Agrega al menos una condición");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        visibility,
        type,
        filters: root
      };
      const res = await fetch(`/api/smart-views/${encodeURIComponent(scope || "")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Error al guardar");
      
      // Cerrar modal y recargar
      setOpen(false);
      window.location.reload();
    } catch (err: any) {
      setError(String(err?.message || "Error al guardar"));
    } finally {
      setLoading(false);
    }
  };

  const openModal = async () => {
    await ensureFieldsLoaded();
    setOpen(true);
  };

  // Si no hay scope, solo es un botón placeholder
  if (!scope) {
    return (
      <button
        className="ghost btn-compact btn-icon-only btn-filter"
        type="button"
        aria-label="Filtros"
        title="Crear filtro inteligente"
        disabled
        style={{ opacity: 0.5 }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M.5 2a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 .56 1.247l-5.06 5.62v4.633a.75.75 0 0 1-1.083.67l-3-1.5a.75.75 0 0 1-.417-.67V8.117l-5.06-5.62A.75.75 0 0 1 .5 2z"/>
        </svg>
      </button>
    );
  }

  return (
    <>
      <button
        className="ghost btn-compact btn-icon-only btn-filter"
        type="button"
        onClick={openModal}
        aria-label="Crear filtro inteligente"
        title="Crear filtro inteligente"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M.5 2a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 .56 1.247l-5.06 5.62v4.633a.75.75 0 0 1-1.083.67l-3-1.5a.75.75 0 0 1-.417-.67V8.117l-5.06-5.62A.75.75 0 0 1 .5 2z"/>
        </svg>
      </button>

      {open && (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(900px, 96vw)", maxHeight: "90vh", overflow: "auto" }}>
            <div className="panel-header" style={{ justifyContent: "space-between" }}>
              <strong>Crear filtro inteligente</strong>
              <button
                className="ghost modal-close"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                data-modal-close="true"
                data-loader="off"
              >
                X
              </button>
            </div>

            <div className="modal-body" style={{ display: "grid", gap: 16 }}>
              {/* Nombre y configuración */}
              <div style={{ display: "grid", gap: 12 }}>
                <div className="field">
                  <label>Nombre del filtro</label>
                  <input
                    className="input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej: Morosos > 30 días"
                    autoFocus
                  />
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Visibilidad</label>
                    <select
                      className="select"
                      value={visibility}
                      onChange={(e) => setVisibility(e.target.value as any)}
                    >
                      <option value="ORG">Público (todos los usuarios)</option>
                      <option value="PRIVATE">Privado (solo yo)</option>
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Tipo</label>
                    <select
                      className="select"
                      value={type}
                      onChange={(e) => setType(e.target.value as any)}
                    >
                      <option value="DYNAMIC">Dinámico (se actualiza automáticamente)</option>
                      <option value="STATIC">Estático (lista fija de contactos)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Reglas */}
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 13 }}>Condiciones</strong>
                  <button
                    className="ghost btn-compact"
                    type="button"
                    onClick={addRule}
                    disabled={fields.length === 0}
                  >
                    + Agregar condición
                  </button>
                </div>

                {error && <div className="field-hint" style={{ color: "var(--danger)" }}>{error}</div>}

                {fields.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12, padding: 12, background: "var(--surface-2)", borderRadius: 8 }}>
                    Cargando campos...
                  </div>
                ) : root.rules.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12, padding: 12, background: "var(--surface-2)", borderRadius: 8 }}>
                    No hay condiciones. Haz clic en "Agregar condición" para comenzar.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {root.rules.map((rule, idx) => {
                      if ("rules" in rule) return null;
                      const field = fields.find((f) => f.key === rule.field) || fields[0];
                      const ops = field?.operators || [];
                      const op = rule.op || ops[0];
                      const needsValue = op !== "exists" && op !== "isEmpty";

                      return (
                        <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span className="muted" style={{ fontSize: 11, minWidth: 20 }}>{idx + 1}.</span>
                          <select
                            className="select select-compact"
                            value={rule.field}
                            onChange={(e) => {
                              const nextField = fields.find((f) => f.key === e.target.value) || fields[0];
                              const nextOp = nextField.operators?.[0] || "equals";
                              updateRule(idx, { field: nextField.key, op: nextOp, value: "" });
                            }}
                            style={{ minWidth: 180, fontSize: 12 }}
                          >
                            {Array.from(new Set(fields.map((f) => f.group))).map((group) => (
                              <optgroup key={group} label={group}>
                                {fields.filter((f) => f.group === group).map((f) => (
                                  <option key={f.key} value={f.key}>{f.label}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <select
                            className="select select-compact"
                            value={op}
                            onChange={(e) => updateRule(idx, { ...rule, op: e.target.value })}
                            style={{ minWidth: 140, fontSize: 12 }}
                          >
                            {ops.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                          {needsValue && (
                            <input
                              className="input input-compact"
                              type="text"
                              value={String(rule.value || "")}
                              onChange={(e) => updateRule(idx, { ...rule, value: e.target.value })}
                              placeholder="Valor"
                              style={{ flex: 1, fontSize: 12 }}
                            />
                          )}
                          <button
                            className="ghost btn-compact btn-icon-only"
                            type="button"
                            onClick={() => removeRule(idx)}
                            aria-label="Eliminar"
                            title="Eliminar condición"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                              <path d="M14 1.41L12.59 0 7 5.59 1.41 0 0 1.41 5.59 7 0 12.59 1.41 14 7 8.41 12.59 14 14 12.59 8.41 7z"/>
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  className="ghost btn-compact"
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={loading}
                >
                  Cancelar
                </button>
                <button
                  className="primary btn-compact"
                  type="button"
                  onClick={saveFilter}
                  disabled={loading || fields.length === 0}
                >
                  {loading ? "Guardando..." : "Guardar filtro"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
