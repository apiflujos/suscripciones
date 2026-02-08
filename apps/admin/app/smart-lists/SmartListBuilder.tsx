"use client";

import { useMemo, useState } from "react";

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
  | "exists"
  | "isEmpty";

type Rule = { field: string; op: RuleOp; value?: string };

const FIELD_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Teléfono" },
  { value: "name", label: "Nombre" },
  { value: "createdAt", label: "Fecha creación" },
  { value: "subscriptionStatus", label: "Estado suscripción" },
  { value: "planName", label: "Plan" },
  { value: "planPrice", label: "Precio plan (cents)" },
  { value: "nextBillingDate", label: "Próximo cobro" },
  { value: "lastPaymentStatus", label: "Último pago estado" },
  { value: "lastPaymentDate", label: "Último pago fecha" },
  { value: "daysPastDue", label: "Días en mora" },
  { value: "inMora", label: "En mora" },
  { value: "hasSubscription", label: "Tiene suscripción" },
  { value: "paymentStatusLastApproved", label: "Último pago aprobado" },
  { value: "metadata.identificacion", label: "Metadata: identificación" },
  { value: "metadata.documentNumber", label: "Metadata: documento" },
  { value: "subscription.metadata.collectionMode", label: "Subs meta: collectionMode" }
];

const OP_OPTIONS: Array<{ value: RuleOp; label: string }> = [
  { value: "equals", label: "Es igual" },
  { value: "contains", label: "Contiene" },
  { value: "startsWith", label: "Empieza por" },
  { value: "endsWith", label: "Termina en" },
  { value: "in", label: "Está en (coma)" },
  { value: "notIn", label: "No está en (coma)" },
  { value: "gt", label: "Mayor que" },
  { value: "gte", label: "Mayor o igual" },
  { value: "lt", label: "Menor que" },
  { value: "lte", label: "Menor o igual" },
  { value: "exists", label: "Existe" },
  { value: "isEmpty", label: "Está vacío" }
];

function serializeRules(rules: Rule[], groupOp: "and" | "or") {
  const normalized = rules
    .filter((r) => r.field && r.op)
    .map((r) => {
      if (r.op === "exists" || r.op === "isEmpty") return { field: r.field, op: r.op };
      if (r.op === "in" || r.op === "notIn") {
        const items = String(r.value || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return { field: r.field, op: r.op, value: items };
      }
      return { field: r.field, op: r.op, value: r.value };
    });
  return JSON.stringify({ op: groupOp, rules: normalized }, null, 0);
}

export function SmartListBuilder() {
  const [rules, setRules] = useState<Rule[]>([{ field: "subscriptionStatus", op: "equals", value: "PAST_DUE" }]);
  const [groupOp, setGroupOp] = useState<"and" | "or">("and");
  const [advanced, setAdvanced] = useState(false);
  const json = useMemo(() => serializeRules(rules, groupOp), [rules, groupOp]);

  function updateRule(idx: number, patch: Partial<Rule>) {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRule(idx: number) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  }

  function addRule() {
    setRules((prev) => prev.concat([{ field: "subscriptionStatus", op: "equals", value: "ACTIVE" }]));
  }

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
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Operador de grupo</label>
              <select className="select" value={groupOp} onChange={(e) => setGroupOp(e.target.value as "and" | "or")}>
                <option value="and">AND (todas)</option>
                <option value="or">OR (cualquiera)</option>
              </select>
            </div>
          </div>
          {rules.map((rule, idx) => {
            const needsValue = rule.op !== "exists" && rule.op !== "isEmpty";
            return (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 2fr auto", gap: 8 }}>
                <select className="select" value={rule.field} onChange={(e) => updateRule(idx, { field: e.target.value })}>
                  {FIELD_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <select className="select" value={rule.op} onChange={(e) => updateRule(idx, { op: e.target.value as RuleOp })}>
                  {OP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {needsValue ? (
                  <input
                    className="input"
                    value={rule.value || ""}
                    onChange={(e) => updateRule(idx, { value: e.target.value })}
                    placeholder="Valor"
                  />
                ) : (
                  <div />
                )}
                <button type="button" className="ghost" onClick={() => removeRule(idx)}>Quitar</button>
              </div>
            );
          })}
          <div>
            <button type="button" className="ghost" onClick={addRule}>Agregar regla</button>
          </div>
        </div>
      ) : (
        <textarea className="input" name="rules" rows={8} defaultValue={json} />
      )}

      {!advanced ? <input type="hidden" name="rules" value={json} /> : null}
      <div className="field-hint">
        Operadores `in` y `notIn` usan valores separados por comas. Fechas en formato ISO.
      </div>
    </div>
  );
}
