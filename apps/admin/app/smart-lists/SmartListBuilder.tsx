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
  { value: "planPrice", label: "Precio plan (cents)", type: "number" },
  { value: "nextBillingDate", label: "Próximo cobro", type: "date" },
  { value: "lastPaymentStatus", label: "Último pago estado", type: "enum", enumValues: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"] },
  { value: "lastPaymentDate", label: "Último pago fecha", type: "date" },
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

function uid() {
  return Math.random().toString(36).slice(2);
}

function fieldByValue(value: string) {
  return FIELDS.find((f) => f.value === value) || FIELDS[0];
}

function defaultRule(field = "subscriptionStatus"): RuleNode {
  const f = fieldByValue(field);
  const op = OPS_BY_TYPE[f.type][0].value;
  let value: any = "";
  if (f.type === "boolean") value = true;
  if (f.type === "enum" && f.enumValues?.length) value = f.enumValues[0];
  if (f.type === "number") value = 0;
  if (f.type === "date") value = new Date().toISOString();
  return { id: uid(), type: "rule", field: f.value, op, value };
}

function defaultGroup(): GroupNode {
  return { id: uid(), type: "group", op: "and", children: [defaultRule()] };
}

function serializeNode(node: Node): any {
  if (node.type === "group") {
    return { op: node.op, rules: node.children.map(serializeNode) };
  }
  const f = fieldByValue(node.field);
  const op = node.op;
  if (op === "exists" || op === "isEmpty") return { field: node.field, op };

  if (f.type === "enum" && (op === "in" || op === "notIn")) {
    const items = Array.isArray(node.value) ? node.value : String(node.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    return { field: node.field, op, value: items };
  }

  if (f.type === "date") {
    if (op === "between") {
      return { field: node.field, op, value: { from: node.value?.from || "", to: node.value?.to || "" } };
    }
    if (op === "within_last" || op === "within_next" || op === "older_than" || op === "newer_than") {
      return { field: node.field, op, value: { amount: Number(node.value?.amount || 0), unit: node.value?.unit || "days" } };
    }
    return { field: node.field, op, value: node.value || "" };
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
    else if (f.type === "date") next.value = new Date().toISOString();
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
                <input className="input" type="datetime-local" value={String(node.value?.from || "")} onChange={(e) => onChange({ ...node, value: { ...(node.value || {}), from: e.target.value } })} />
                <input className="input" type="datetime-local" value={String(node.value?.to || "")} onChange={(e) => onChange({ ...node, value: { ...(node.value || {}), to: e.target.value } })} />
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
              <input className="input" type="datetime-local" value={String(node.value || "")} onChange={(e) => onChange({ ...node, value: e.target.value })} />
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
        <strong>Condición</strong>
        <select className="select" value={node.op} onChange={(e) => onChange({ ...node, op: e.target.value as GroupOp })}>
          <option value="and">AND (todas)</option>
          <option value="or">OR (cualquiera)</option>
        </select>
        {onRemove ? (
          <button type="button" className="ghost" onClick={onRemove} style={{ marginLeft: "auto" }}>Quitar grupo</button>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="ghost" onClick={() => onChange({ ...node, children: node.children.concat([defaultRule()]) })}>
          Agregar regla
        </button>
        <button type="button" className="ghost" onClick={() => onChange({ ...node, children: node.children.concat([defaultGroup()]) })}>
          Agregar grupo
        </button>
      </div>
    </div>
  );
}

export function SmartListBuilder() {
  const [root, setRoot] = useState<GroupNode>(defaultGroup());
  const [advanced, setAdvanced] = useState(false);
  const json = useMemo(() => JSON.stringify(serializeNode(root), null, 0), [root]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong>Reglas</strong>
        <label className="checkbox" style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          <span>Modo avanzado (JSON)</span>
        </label>
      </div>

      {!advanced ? (
        <GroupEditor node={root} depth={0} onChange={setRoot} />
      ) : (
        <textarea className="input" name="rules" rows={10} defaultValue={json} />
      )}

      {!advanced ? <input type="hidden" name="rules" value={json} /> : null}
      <div className="field-hint">
        Fechas relativas soportan segundos, minutos, horas, días. Para listas usa coma. Puedes anidar grupos AND/OR.
      </div>
    </div>
  );
}
