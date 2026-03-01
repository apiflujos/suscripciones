"use client";

import { useEffect, useMemo, useState } from "react";

type SmartField = {
  key: string;
  label: string;
  group: string;
  type: "text" | "number" | "date" | "boolean" | "enum" | "phone" | "money";
  operators: Array<
    | "equals"
    | "contains"
    | "startsWith"
    | "endsWith"
    | "in"
    | "notIn"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "before"
    | "after"
    | "between"
    | "within_last"
    | "within_next"
    | "older_than"
    | "newer_than"
    | "exists"
    | "isEmpty"
  >;
  options?: Array<{ value: string; label: string }>;
  optionsSource?: string;
};

type SmartView = {
  id: string;
  name: string;
  visibility: "ORG" | "PRIVATE";
  type: "DYNAMIC" | "STATIC";
  filters?: any;
};

type Rule =
  | { field: string; op: string; value?: any }
  | { op: "and" | "or"; rules: Rule[] };

type ViewMode = "list" | "filters";

const FIELD_OP_LABELS: Record<string, string> = {
  equals: "Es igual",
  contains: "Contiene",
  startsWith: "Empieza por",
  endsWith: "Termina en",
  in: "Está en",
  notIn: "No está en",
  gt: "Mayor que",
  gte: "Mayor o igual",
  lt: "Menor que",
  lte: "Menor o igual",
  before: "Antes de",
  after: "Después de",
  between: "Entre",
  within_last: "En los últimos",
  within_next: "En los próximos",
  older_than: "Hace más de",
  newer_than: "Hace menos de",
  exists: "Existe",
  isEmpty: "Está vacío"
};

const UNITS = [
  { value: "minutes", label: "minutos" },
  { value: "hours", label: "horas" },
  { value: "days", label: "días" }
];

function defaultRule(fieldKey: string, fields: SmartField[]): Rule {
  const f = fields.find((field) => field.key === fieldKey) || fields[0];
  const op = f?.operators?.[0] || "equals";
  let value: any = "";
  if (f?.type === "boolean") value = true;
  if (f?.type === "number") value = 0;
  if (f?.type === "date") value = new Date().toISOString().slice(0, 16);
  if (f?.type === "enum") value = f.options?.[0]?.value || "";
  return { field: f?.key || "", op, value } as Rule;
}

function serializeRule(rule: Rule): any {
  if ("rules" in rule) return { op: rule.op, rules: rule.rules.map(serializeRule) };
  const op = rule.op;
  if (op === "exists" || op === "isEmpty") return { field: rule.field, op };
  return { field: rule.field, op, value: rule.value };
}

function collectRuleFields(rule: Rule, acc: Set<string>) {
  if ("rules" in rule) {
    rule.rules.forEach((r) => collectRuleFields(r, acc));
    return;
  }
  if (rule.field) acc.add(rule.field);
}

export function SmartViewsBar({
  scope,
  initialViewId,
  initialFilters,
  baseParams
}: {
  scope: string;
  initialViewId: string;
  initialFilters: string;
  baseParams: Record<string, string>;
}) {
  const [views, setViews] = useState<SmartView[]>([]);
  const [fields, setFields] = useState<SmartField[]>([]);
  const [activeViewId, setActiveViewId] = useState(initialViewId);
  const [mode, setMode] = useState<ViewMode>("list");
  const [editingId, setEditingId] = useState<string>("");
  const [root, setRoot] = useState<Rule>(() => {
    if (initialFilters) {
      try {
        return JSON.parse(initialFilters) as Rule;
      } catch {
        return { op: "and", rules: [] };
      }
    }
    return { op: "and", rules: [] };
  });
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"ORG" | "PRIVATE">("ORG");
  const [type, setType] = useState<"DYNAMIC" | "STATIC">("DYNAMIC");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const groupedFields = useMemo(() => {
    const map = new Map<string, SmartField[]>();
    fields.forEach((f) => {
      if (!map.has(f.group)) map.set(f.group, []);
      map.get(f.group)!.push(f);
    });
    return Array.from(map.entries());
  }, [fields]);

  useEffect(() => {
    const load = async () => {
      const viewsRes = await fetch(`/api/smart-views/${encodeURIComponent(scope)}`);
      const viewsJson = await viewsRes.json().catch(() => ({}));
      setViews(Array.isArray(viewsJson.items) ? viewsJson.items : []);
    };
    load().catch(() => null);
  }, [scope]);

  async function ensureFieldsLoaded() {
    if (fields.length) return;
    const fieldsRes = await fetch(`/api/smart-views/${encodeURIComponent(scope)}/fields`);
    const fieldsJson = await fieldsRes.json().catch(() => ({}));
    const loadedFields = Array.isArray(fieldsJson.fields) ? fieldsJson.fields : [];
    setFields(loadedFields);
    if ("rules" in root && root.rules.length === 0 && loadedFields.length) {
      setRoot({ op: "and", rules: [defaultRule(loadedFields[0].key, loadedFields)] });
    }
  }

  useEffect(() => {
    if (!("rules" in root) || !fields.length) return;
    const keys = new Set<string>();
    collectRuleFields(root, keys);
    keys.forEach((key) => {
      const field = fields.find((f) => f.key === key);
      if (field?.optionsSource && (!field.options || field.options.length === 0)) {
        loadOptions(field).catch(() => null);
      }
    });
  }, [root, fields, scope]);

  async function loadOptions(field: SmartField) {
    if (!field.optionsSource) return;
    if (field.options && field.options.length) return;
    const res = await fetch(`/api/smart-views/${encodeURIComponent(scope)}/options?field=${encodeURIComponent(field.key)}`);
    const json = await res.json().catch(() => ({}));
    if (Array.isArray(json.options)) {
      setFields((prev) =>
        prev.map((f) => (f.key === field.key ? { ...f, options: json.options } : f))
      );
    }
  }

  const hasRules = "rules" in root && root.rules.length > 0;

  function buildHref(next: { viewId?: string; filters?: string }) {
    const sp = new URLSearchParams(baseParams);
    if (next.viewId) sp.set("viewId", next.viewId);
    else sp.delete("viewId");
    if (next.filters) sp.set("filters", next.filters);
    else sp.delete("filters");
    const qs = sp.toString();
    return qs ? `?${qs}` : "";
  }

  async function deleteView(id: string) {
    if (!id) return;
    if (!confirm("¿Eliminar esta vista?") ) return;
    const res = await fetch(`/api/smart-views/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }).catch(() => null);
    if (!res || !res.ok) return;
    setViews((prev) => prev.filter((v) => v.id !== id));
    if (activeViewId === id) {
      setActiveViewId("");
      window.location.href = buildHref({ viewId: undefined, filters: undefined });
    }
  }

  async function resolveStaticIds() {
    const res = await fetch(`/api/smart-views/${encodeURIComponent(scope)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filters: serializeRule(root) })
    });
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json?.ids) ? json.ids : [];
  }

  async function saveView() {
    setLoading(true);
    setError(null);
    setNotice(null);
    if (!name.trim()) {
      setError("El nombre de la vista es obligatorio.");
      setLoading(false);
      return;
    }
    if (!hasRules) {
      setError("Agrega al menos una condición antes de guardar.");
      setLoading(false);
      return;
    }
    try {
      let staticIds: string[] | undefined;
      if (type === "STATIC") {
        staticIds = await resolveStaticIds();
      }
      const payload = {
        name: name.trim(),
        visibility,
        type,
        filters: serializeRule(root),
        ...(staticIds ? { staticIds } : {})
      };
      const target = editingId
        ? `/api/smart-views/${encodeURIComponent(scope)}/${encodeURIComponent(editingId)}`
        : `/api/smart-views/${encodeURIComponent(scope)}`;
      const res = await fetch(target, {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "save_failed");
      if (editingId) {
        setViews((prev) => prev.map((v) => (v.id === editingId ? json.view : v)));
      } else {
        setViews((prev) => [json.view, ...prev]);
      }
      const nextId = String(json.view?.id || editingId || "");
      setActiveViewId(nextId);
      setMode("list");
      setEditingId("");
      setNotice(editingId ? "Vista actualizada." : "Vista guardada.");
      window.location.href = buildHref({ viewId: nextId || undefined, filters: undefined });
    } catch (err: any) {
      setError(String(err?.message || "save_failed"));
    } finally {
      setLoading(false);
    }
  }

  function addRule() {
    if (!fields.length) return;
    setError(null);
    const nextField = fields[0]?.key || "";
    const rule = defaultRule(nextField, fields);
    if ("rules" in root) {
      setRoot({ ...root, rules: [...root.rules, rule] });
    }
  }

  function updateRule(index: number, next: Rule) {
    if (!("rules" in root)) return;
    setError(null);
    const rules = [...root.rules];
    rules[index] = next;
    setRoot({ ...root, rules });
  }

  function removeRule(index: number) {
    if (!("rules" in root)) return;
    const rules = root.rules.filter((_, i) => i !== index);
    setRoot({ ...root, rules });
  }

  function renderRule(rule: Rule, index: number) {
    if ("rules" in rule) return null;
    const field = fields.find((f) => f.key === rule.field) || fields[0];
    if (!field) return null;
    const ops = field.operators;
    const op = rule.op || ops[0];
    const needsValue = op !== "exists" && op !== "isEmpty";
    const isRelative = field.type === "date" && ["within_last", "within_next", "older_than", "newer_than"].includes(op);
    const isBetween = field.type === "date" && op === "between";
    const isEnumList = field.type === "enum" && (op === "in" || op === "notIn");

    return (
      <div key={index} className="smartRuleRow">
        <select
          className="select"
          value={rule.field}
          onChange={(e) => {
            const nextField = fields.find((f) => f.key === e.target.value) || fields[0];
            if (!nextField) return;
            if (nextField.optionsSource) loadOptions(nextField).catch(() => null);
            updateRule(index, defaultRule(nextField.key, fields));
          }}
        >
          {groupedFields.map(([group, groupFields]) => (
            <optgroup key={group} label={group}>
              {groupFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select
          className="select"
          value={op}
          onChange={(e) => updateRule(index, { ...rule, op: e.target.value })}
        >
          {ops.map((o) => (
            <option key={o} value={o}>
              {FIELD_OP_LABELS[o] || o}
            </option>
          ))}
        </select>
        {needsValue ? (
          <div>
            {field.type === "boolean" ? (
              <select
                className="select"
                value={String(rule.value)}
                onChange={(e) => updateRule(index, { ...rule, value: e.target.value === "true" })}
              >
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            ) : field.type === "enum" ? (
              isEnumList ? (
                <input
                  className="input"
                  value={String(rule.value || "")}
                  placeholder="Valores separados por coma"
                  onChange={(e) => updateRule(index, { ...rule, value: e.target.value })}
                />
              ) : (
                <select
                  className="select"
                  value={String(rule.value || "")}
                  onChange={(e) => updateRule(index, { ...rule, value: e.target.value })}
                >
                  {(field.options || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )
            ) : field.type === "number" ? (
              op === "between" ? (
                <div className="smartRange">
                  <input
                    className="input"
                    type="number"
                    value={String(rule.value?.from || "")}
                    onChange={(e) => updateRule(index, { ...rule, value: { ...(rule.value || {}), from: e.target.value } })}
                    placeholder="Desde"
                  />
                  <input
                    className="input"
                    type="number"
                    value={String(rule.value?.to || "")}
                    onChange={(e) => updateRule(index, { ...rule, value: { ...(rule.value || {}), to: e.target.value } })}
                    placeholder="Hasta"
                  />
                </div>
              ) : (
                <input
                  className="input"
                  type="number"
                  value={String(rule.value ?? "")}
                  onChange={(e) => updateRule(index, { ...rule, value: e.target.value })}
                />
              )
            ) : field.type === "date" ? (
              isBetween ? (
                <div className="smartRange">
                  <input
                    className="input"
                    type="datetime-local"
                    value={String(rule.value?.from || "")}
                    onChange={(e) => updateRule(index, { ...rule, value: { ...(rule.value || {}), from: e.target.value } })}
                  />
                  <input
                    className="input"
                    type="datetime-local"
                    value={String(rule.value?.to || "")}
                    onChange={(e) => updateRule(index, { ...rule, value: { ...(rule.value || {}), to: e.target.value } })}
                  />
                </div>
              ) : isRelative ? (
                <div className="smartRange">
                  <input
                    className="input"
                    type="number"
                    value={String(rule.value?.amount || "")}
                    onChange={(e) => updateRule(index, { ...rule, value: { ...(rule.value || {}), amount: e.target.value } })}
                    placeholder="Cantidad"
                  />
                  <select
                    className="select"
                    value={String(rule.value?.unit || "days")}
                    onChange={(e) => updateRule(index, { ...rule, value: { ...(rule.value || {}), unit: e.target.value } })}
                  >
                    {UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  className="input"
                  type="datetime-local"
                  value={String(rule.value || "")}
                  onChange={(e) => updateRule(index, { ...rule, value: e.target.value })}
                />
              )
            ) : (
              <input
                className="input"
                value={String(rule.value ?? "")}
                onChange={(e) => updateRule(index, { ...rule, value: e.target.value })}
              />
            )}
          </div>
        ) : (
          <div />
        )}
        <button className="ghost" type="button" onClick={() => removeRule(index)}>
          Quitar
        </button>
      </div>
    );
  }

  return (
    <div className="smartViewsBar">
      <div className="smartViewsTop">
        <select
          className="select"
          value={activeViewId}
          onChange={(e) => {
            const id = e.target.value;
            setActiveViewId(id);
            setEditingId("");
            window.location.href = buildHref({ viewId: id || undefined, filters: undefined });
          }}
        >
          <option value="">Vista: Todas</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name} {view.visibility === "PRIVATE" ? "(Privada)" : ""}
            </option>
          ))}
        </select>
        {activeViewId ? (
          <div className="smartViewsActive">
            Vista activa: {views.find((v) => v.id === activeViewId)?.name || ""}
          </div>
        ) : null}
        {activeViewId ? (
          <button
            className="ghost"
            type="button"
            onClick={() => {
              const view = views.find((v) => v.id === activeViewId);
              if (!view) return;
              setEditingId(view.id);
              setName(view.name || "");
              setVisibility(view.visibility || "ORG");
              setType(view.type || "DYNAMIC");
              setNotice(null);
              if (view.filters && typeof view.filters === "object") {
                setRoot(view.filters as Rule);
              } else if (fields.length) {
                setRoot({ op: "and", rules: [defaultRule(fields[0].key, fields)] });
              }
              setMode("filters");
            }}
          >
            Editar
          </button>
        ) : null}
        {activeViewId ? (
          <button className="ghost" type="button" onClick={() => deleteView(activeViewId)}>
            Eliminar
          </button>
        ) : null}
        <div className="smartViewsActions">
          <button
            className="ghost"
            type="button"
            onClick={() => {
              setMode("filters");
              setActiveViewId("");
              setEditingId("");
              setNotice(null);
              ensureFieldsLoaded().catch(() => null);
            }}
          >
            Filtros avanzados
          </button>
        </div>
      </div>

      {mode === "filters" ? (
        <div className="smartViewsModal">
          <div className="smartViewsModalCard">
            <div className="smartViewsModalHeader">
              <div>
                <strong>Filtros inteligentes</strong>
                <div className="muted">Configura condiciones con datos reales.</div>
              </div>
              <button className="ghost" type="button" onClick={() => setMode("list")}>
                Cerrar
              </button>
            </div>

            {fields.length === 0 ? (
              <div className="muted">Cargando campos...</div>
            ) : (
              "rules" in root && root.rules.map((rule, index) => renderRule(rule, index))
            )}

            {fields.length ? (
              <>
                <div className="smartViewsFooter">
                  <button className="ghost" type="button" onClick={addRule}>
                    + Agregar condición
                  </button>
                </div>

                <div className="smartViewsSave">
                  <div className="smartViewsSaveRow" style={{ marginBottom: 10 }}>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => {
                        if (!fields.length) return;
                        if (!hasRules) {
                          setError("Agrega al menos una condición antes de aplicar.");
                          return;
                        }
                        setError(null);
                        const serialized = encodeURIComponent(JSON.stringify(serializeRule(root)));
                        window.location.href = buildHref({ filters: serialized, viewId: undefined });
                      }}
                    >
                      Aplicar filtros
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => {
                        if (!fields.length) return;
                        setError(null);
                        setRoot({ op: "and", rules: [defaultRule(fields[0]?.key || "", fields)] });
                      }}
                    >
                      Limpiar
                    </button>
                  </div>
                  <div className="smartViewsSaveRow">
                    <input
                      className="input"
                      placeholder="Nombre de la vista"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <select className="select" value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
                      <option value="ORG">Organización</option>
                      <option value="PRIVATE">Privada</option>
                    </select>
                    <select className="select" value={type} onChange={(e) => setType(e.target.value as any)}>
                      <option value="DYNAMIC">Dinámica</option>
                      <option value="STATIC">Estática</option>
                    </select>
                    <button className="primary" type="button" disabled={!name.trim() || loading} onClick={saveView}>
                      {loading ? "Guardando..." : editingId ? "Actualizar vista" : "Guardar vista"}
                    </button>
                  </div>
                  {error ? <div className="error">{error}</div> : null}
                  {notice ? <div className="notice">{notice}</div> : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
