"use client";

import { useMemo, useState } from "react";

type GroupOp = "and" | "or";
type RuleOp =
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
  | "isEmpty";

type RuleNode = {
  id: string;
  type: "rule";
  field: string;
  op: RuleOp;
  value?: any;
};

type GroupNode = {
  id: string;
  type: "group";
  op: GroupOp;
  children: Array<GroupNode | RuleNode>;
};

type Node = GroupNode | RuleNode;

type FieldType = "text" | "number" | "date" | "boolean" | "enum";
type FieldOption = { value: string; label: string; type: FieldType; enumValues?: string[] };

const FIELDS: FieldOption[] = [
  { value: "email", label: "Email", type: "text" },
  { value: "phone", label: "Teléfono", type: "text" },
  { value: "name", label: "Nombre", type: "text" },
  { value: "createdAt", label: "Fecha creación", type: "date" },
  { value: "subscriptionStatus", label: "Estado suscripción", type: "enum", enumValues: ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"] },
  { value: "planName", label: "Plan", type: "text" },
  { value: "planActive", label: "Plan activo", type: "boolean" },
  { value: "planPrice", label: "Precio plan (COP)", type: "number" },
  { value: "nextBillingDate", label: "Próximo cobro", type: "date" },
  { value: "lastPaymentStatus", label: "Último pago estado", type: "enum", enumValues: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"] },
  { value: "lastPaymentDate", label: "Último pago fecha", type: "date" },
  { value: "paymentsCount", label: "Pagos totales", type: "number" },
  { value: "approvedPaymentsCount", label: "Pagos aprobados", type: "number" },
  { value: "tier", label: "Nivel gamificación", type: "enum", enumValues: ["Rookie", "Bronce", "Plata", "Oro"] },
  { value: "gamificationLevel", label: "Nivel gamificación (1-10)", type: "number" },
  { value: "gamificationLevelName", label: "Nivel gamificación (nombre)", type: "enum", enumValues: ["Rookie", "Explorador", "Bronce", "Plata", "Oro", "Platino", "Diamante", "Elite", "Maestro", "Leyenda"] },
  { value: "gamificationScore", label: "Score gamificación", type: "number" },
  { value: "gamificationLifetime", label: "Puntos históricos", type: "number" },
  { value: "daysPastDue", label: "Días en mora", type: "number" },
  { value: "inMora", label: "En mora", type: "boolean" },
  { value: "hasSubscription", label: "Tiene suscripción", type: "boolean" },
  { value: "paymentStatusLastApproved", label: "Último pago aprobado", type: "boolean" },
  { value: "metadata.identificacion", label: "Metadata: identificación", type: "text" },
  { value: "metadata.documentNumber", label: "Metadata: documento", type: "text" },
  { value: "subscription.metadata.collectionMode", label: "Subs meta: collectionMode", type: "text" }
];

const OPS_BY_TYPE: Record<FieldType, Array<{ value: RuleOp; label: string }>> = {
  text: [
    { value: "equals", label: "Es igual" },
    { value: "contains", label: "Contiene" },
    { value: "startsWith", label: "Empieza por" },
    { value: "endsWith", label: "Termina en" },
    { value: "exists", label: "Existe" },
    { value: "isEmpty", label: "Está vacío" }
  ],
  number: [
    { value: "equals", label: "Es igual" },
    { value: "gt", label: "Mayor que" },
    { value: "gte", label: "Mayor o igual" },
    { value: "lt", label: "Menor que" },
    { value: "lte", label: "Menor o igual" },
    { value: "between", label: "Entre" },
    { value: "exists", label: "Existe" }
  ],
  boolean: [
    { value: "equals", label: "Es" }
  ],
  enum: [
    { value: "equals", label: "Es igual" },
    { value: "in", label: "Está en" },
    { value: "notIn", label: "No está en" }
  ],
  date: [
    { value: "before", label: "Antes de" },
    { value: "after", label: "Después de" },
    { value: "between", label: "Entre" },
    { value: "within_last", label: "En los últimos" },
    { value: "within_next", label: "En los próximos" },
    { value: "older_than", label: "Hace más de" },
    { value: "newer_than", label: "Hace menos de" }
  ]
};

const UNITS = [
  { value: "seconds", label: "segundos" },
  { value: "minutes", label: "minutos" },
  { value: "hours", label: "horas" },
  { value: "days", label: "días" }
];

type InitCtx = {
  idFactory?: () => string;
  nowIso?: string;
};

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInputValue(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toIsoValue(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

function uid(ctx?: InitCtx) {
  return ctx?.idFactory ? ctx.idFactory() : randomId();
}

function defaultDateValue(ctx?: InitCtx) {
  return toLocalInputValue(ctx?.nowIso || new Date().toISOString());
}

function makeRule(field: string, op: RuleOp, value?: any, ctx?: InitCtx): RuleNode {
  return { id: uid(ctx), type: "rule", field, op, value };
}

function presetToRoot(preset?: string, ctx?: InitCtx): GroupNode | null {
  if (preset === "past_due") {
    return { id: uid(ctx), type: "group", op: "and", children: [makeRule("subscriptionStatus", "equals", "PAST_DUE", ctx)] };
  }
  return null;
}

function fieldByValue(value: string) {
  return FIELDS.find((f) => f.value === value) || FIELDS[0];
}

function defaultRule(field = "subscriptionStatus", ctx?: InitCtx): RuleNode {
  const f = fieldByValue(field);
  const op = OPS_BY_TYPE[f.type][0].value;
  let value: any = "";
  if (f.type === "boolean") value = true;
  if (f.type === "enum" && f.enumValues?.length) value = f.enumValues[0];
  if (f.type === "number") value = 0;
  if (f.type === "date") value = defaultDateValue(ctx);
  return { id: uid(ctx), type: "rule", field: f.value, op, value };
}

function defaultGroup(ctx?: InitCtx): GroupNode {
  return { id: uid(ctx), type: "group", op: "and", children: [defaultRule(undefined, ctx)] };
}

function serializeNode(node: Node): any {
  if (node.type === "group") {
    return { op: node.op, rules: node.children.map(serializeNode) };
  }
  const f = fieldByValue(node.field);
  const op = node.op;
  if (op === "exists" || op === "isEmpty") return { field: node.field, op };
  const toNumber = (value: any) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  if (f.type === "enum" && (op === "in" || op === "notIn")) {
    const items = Array.isArray(node.value) ? node.value : String(node.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    return { field: node.field, op, value: items };
  }

  if (f.type === "number") {
    if (op === "between") {
      return { field: node.field, op, value: { from: toNumber(node.value?.from), to: toNumber(node.value?.to) } };
    }
    return { field: node.field, op, value: toNumber(node.value) };
  }

  if (f.type === "date") {
    if (op === "between") {
      return {
        field: node.field,
        op,
        value: { from: toIsoValue(node.value?.from || ""), to: toIsoValue(node.value?.to || "") }
      };
    }
    if (op === "within_last" || op === "within_next" || op === "older_than" || op === "newer_than") {
      return { field: node.field, op, value: { amount: Number(node.value?.amount || 0), unit: node.value?.unit || "days" } };
    }
    return { field: node.field, op, value: toIsoValue(node.value || "") };
  }

  return { field: node.field, op, value: node.value };
}

function RuleEditor({ node, onChange, onRemove }: { node: RuleNode; onChange: (n: RuleNode) => void; onRemove: () => void }) {
  const field = fieldByValue(node.field);
  const ops = OPS_BY_TYPE[field.type];

  function setField(val: string) {
    const f = fieldByValue(val);
    const op = OPS_BY_TYPE[f.type][0].value;
      const next = { ...node, field: f.value, op };
      if (f.type === "boolean") next.value = true;
      else if (f.type === "enum" && f.enumValues?.length) next.value = f.enumValues[0];
      else if (f.type === "number") next.value = 0;
      else if (f.type === "date") next.value = defaultDateValue();
      else next.value = "";
    onChange(next);
  }

  const needsValue = !(node.op === "exists" || node.op === "isEmpty");
  const isRelativeDate = field.type === "date" && ["within_last", "within_next", "older_than", "newer_than"].includes(node.op);
  const isBetweenDate = field.type === "date" && node.op === "between";
  const isEnumList = field.type === "enum" && (node.op === "in" || node.op === "notIn");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 2.5fr auto", gap: 8, alignItems: "center" }}>
      <select className="select" value={node.field} onChange={(e) => setField(e.target.value)}>
        {FIELDS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <select className="select" value={node.op} onChange={(e) => onChange({ ...node, op: e.target.value as RuleOp })}>
        {ops.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {needsValue ? (
        <div>
          {field.type === "boolean" ? (
            <select className="select" value={String(node.value)} onChange={(e) => onChange({ ...node, value: e.target.value === "true" })}>
              <option value="true">Verdadero</option>
              <option value="false">Falso</option>
            </select>
          ) : field.type === "enum" ? (
            isEnumList ? (
              <input className="input" value={String(node.value || "")} onChange={(e) => onChange({ ...node, value: e.target.value })} placeholder="Valores separados por coma" />
            ) : (
              <select className="select" value={String(node.value || "")} onChange={(e) => onChange({ ...node, value: e.target.value })}>
                {field.enumValues?.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            )
          ) : field.type === "number" ? (
            node.op === "between" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input className="input" type="number" value={String(node.value?.from || "")} onChange={(e) => onChange({ ...node, value: { ...(node.value || {}), from: e.target.value } })} placeholder="Desde" />
                <input className="input" type="number" value={String(node.value?.to || "")} onChange={(e) => onChange({ ...node, value: { ...(node.value || {}), to: e.target.value } })} placeholder="Hasta" />
              </div>
            ) : (
              <input className="input" type="number" value={String(node.value ?? "")} onChange={(e) => onChange({ ...node, value: e.target.value })} />
            )
          ) : field.type === "date" ? (
            isBetweenDate ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input className="input" type="datetime-local" step="60" value={String(node.value?.from || "")} onChange={(e) => onChange({ ...node, value: { ...(node.value || {}), from: e.target.value } })} />
                <input className="input" type="datetime-local" step="60" value={String(node.value?.to || "")} onChange={(e) => onChange({ ...node, value: { ...(node.value || {}), to: e.target.value } })} />
              </div>
            ) : isRelativeDate ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input className="input" type="number" value={String(node.value?.amount || "")} onChange={(e) => onChange({ ...node, value: { ...(node.value || {}), amount: e.target.value } })} placeholder="Cantidad" />
                <select className="select" value={String(node.value?.unit || "days")} onChange={(e) => onChange({ ...node, value: { ...(node.value || {}), unit: e.target.value } })}>
                  {UNITS.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <input className="input" type="datetime-local" step="60" value={String(node.value || "")} onChange={(e) => onChange({ ...node, value: e.target.value })} />
            )
          ) : (
            <input className="input" value={String(node.value ?? "")} onChange={(e) => onChange({ ...node, value: e.target.value })} />
          )}
        </div>
      ) : (
        <div />
      )}
      <button type="button" className="ghost" onClick={onRemove}>Quitar</button>
    </div>
  );
}

function GroupEditor({
  node,
  onChange,
  onRemove,
  depth
}: {
  node: GroupNode;
  onChange: (n: GroupNode) => void;
  onRemove?: () => void;
  depth: number;
}) {
  function updateChild(idx: number, child: Node) {
    const next = { ...node, children: node.children.map((c, i) => (i === idx ? child : c)) };
    onChange(next);
  }

  function removeChild(idx: number) {
    const next = { ...node, children: node.children.filter((_, i) => i !== idx) };
    onChange(next.children.length ? next : { ...node, children: [defaultRule()] });
  }

  return (
    <div style={{ display: "grid", gap: 8, paddingLeft: depth ? 12 : 0, borderLeft: depth ? "2px solid var(--line)" : "none" }}>
      {node.children.map((child, idx) =>
        child.type === "group" ? (
          <GroupEditor
            key={child.id}
            node={child}
            depth={depth + 1}
            onChange={(n) => updateChild(idx, n)}
            onRemove={() => removeChild(idx)}
          />
        ) : (
          <RuleEditor
            key={child.id}
            node={child}
            onChange={(n) => updateChild(idx, n)}
            onRemove={() => removeChild(idx)}
          />
        )
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>Condicional</strong>
        <select className="select" value={node.op} onChange={(e) => onChange({ ...node, op: e.target.value as GroupOp })}>
          <option value="and">Todas</option>
          <option value="or">Cualquiera</option>
        </select>
        {onRemove ? (
          <button type="button" className="ghost" onClick={onRemove} style={{ marginLeft: "auto" }}>Quitar condicional</button>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="ghost" onClick={() => onChange({ ...node, children: node.children.concat([defaultRule()]) })}>
          Agregar filtro
        </button>
      </div>
    </div>
  );
}

function coerceRoot(input?: any, ctx?: InitCtx): GroupNode | null {
  if (!input || typeof input !== "object") return null;
  if (input.op !== "and" && input.op !== "or") return null;
  if (!Array.isArray(input.rules)) return null;
  const normalizeRuleValue = (field: string, op: RuleOp, value: any) => {
    const f = fieldByValue(field);
    if (f.type === "enum" && (op === "in" || op === "notIn")) {
      if (Array.isArray(value)) return value.join(", ");
      return String(value || "");
    }
    if (f.type === "date") {
      if (op === "between") {
        return {
          from: toLocalInputValue(value?.from),
          to: toLocalInputValue(value?.to)
        };
      }
      if (op === "within_last" || op === "within_next" || op === "older_than" || op === "newer_than") {
        return {
          amount: String(value?.amount ?? value?.value ?? ""),
          unit: String(value?.unit || "days")
        };
      }
      return toLocalInputValue(value);
    }
    return value;
  };
  return {
    id: uid(ctx),
    type: "group",
    op: input.op,
    children: input.rules.map((r: any) => {
      if (r?.op && Array.isArray(r?.rules)) {
        return {
          id: uid(ctx),
          type: "group",
          op: r.op === "or" ? "or" : "and",
          children: r.rules.map((child: any) => ({
            id: uid(ctx),
            type: "rule",
            field: String(child?.field || "name"),
            op: (child?.op as RuleOp) || "equals",
            value: normalizeRuleValue(String(child?.field || "name"), (child?.op as RuleOp) || "equals", child?.value)
          }))
        };
      }
      const field = String(r?.field || "name");
      const op = (r?.op as RuleOp) || "equals";
      return {
        id: uid(ctx),
        type: "rule",
        field,
        op,
        value: normalizeRuleValue(field, op, r?.value)
      };
    })
  };
}

function hashSeed(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function createInitCtx(seed: string, nowIso?: string): InitCtx {
  const prefix = hashSeed(seed || "smartlist");
  let seq = 0;
  return {
    nowIso,
    idFactory: () => `${prefix}_${seq++}`
  };
}

export function SmartListBuilder({
  preset,
  initialRules,
  nowIso
}: {
  preset?: string;
  initialRules?: any;
  nowIso?: string;
}) {
  const seed = useMemo(() => JSON.stringify({ preset: preset || "", rules: initialRules || null }), [preset, initialRules]);
  const initCtx = useMemo(() => createInitCtx(seed, nowIso), [seed, nowIso]);
  const [root, setRoot] = useState<GroupNode>(() => coerceRoot(initialRules, initCtx) || presetToRoot(preset, initCtx) || defaultGroup(initCtx));
  const json = useMemo(() => JSON.stringify(serializeNode(root), null, 0), [root]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong>Filtros</strong>
      </div>

      <GroupEditor node={root} depth={0} onChange={setRoot} />
      <input type="hidden" name="rules" value={json} />
      <div className="field-hint">
        Fechas absolutas se guardan en UTC. Fechas relativas soportan segundos, minutos, horas, días. Para listas usa coma.
        <br />
        Nivel gamificación: usa `gamificationLevel` (1-10) o `gamificationLevelName` para los nuevos niveles. `tier` es legado.
      </div>
    </div>
  );
}
