"use client";

import { useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";

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
};

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "SUBSCRIPTION_DUE" | "PAYMENT_LINK_CREATED" | "PAYMENT_APPROVED" | "PAYMENT_DECLINED";
  templateId: string;
  offsetsSeconds?: number[];
  atTimeUtc?: string | null;
  ensurePaymentLink?: boolean;
  conditions?: {
    requirePaymentTypeIn?: Array<"PLAN" | "SUBSCRIPTION" | "LINK">;
  };
};

type RealtimeKey =
  | "payment_link_created"
  | "payment_success_subscription"
  | "payment_success_plan"
  | "payment_success_link"
  | "payment_failed_subscription"
  | "payment_failed_plan"
  | "payment_failed_link";

const REALTIME_TYPES: Array<{
  key: RealtimeKey;
  label: string;
  trigger: Rule["trigger"];
  chatwootType: Template["chatwootType"];
  paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK";
}> = [
  { key: "payment_link_created", label: "Link de pago creado", trigger: "PAYMENT_LINK_CREATED", chatwootType: "PAYMENT_LINK", paymentType: "LINK" },
  { key: "payment_success_subscription", label: "Pago exitoso (suscripción)", trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED", paymentType: "SUBSCRIPTION" },
  { key: "payment_success_plan", label: "Pago exitoso (plan)", trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED", paymentType: "PLAN" },
  { key: "payment_success_link", label: "Pago recibido por link de pago", trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED", paymentType: "LINK" },
  { key: "payment_failed_subscription", label: "Pago fallido (suscripción)", trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "SUBSCRIPTION" },
  { key: "payment_failed_plan", label: "Pago fallido (plan)", trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "PLAN" },
  { key: "payment_failed_link", label: "Pago fallido (link de pago)", trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "LINK" }
];

const REMINDER_TPL_DUE = "tpl_reminder_due";
const REMINDER_TPL_MORA = "tpl_reminder_mora";

type OffsetItem = { amount: string; unit: "minutes" | "hours" | "days" };

function secondsFromOffset(item: OffsetItem, sign: 1 | -1) {
  const amount = Number(item.amount || 0);
  const base = item.unit === "days" ? amount * 24 * 60 * 60 : item.unit === "hours" ? amount * 60 * 60 : amount * 60;
  return Math.trunc(base * sign);
}

function offsetsToItems(offsets?: number[], sign: 1 | -1 = -1): OffsetItem[] {
  if (!offsets?.length) return [{ amount: "1", unit: "days" }];
  return offsets.map((sec) => {
    const abs = Math.abs(Number(sec));
    if (abs % (24 * 60 * 60) === 0) return { amount: String(abs / (24 * 60 * 60)), unit: "days" };
    if (abs % (60 * 60) === 0) return { amount: String(abs / (60 * 60)), unit: "hours" };
    return { amount: String(abs / 60), unit: "minutes" };
  });
}

export function NotificationsSimple({
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
    saveRealtime: (formData: FormData) => void;
    saveReminder: (formData: FormData) => void;
  };
}) {
  const templateById = useMemo(() => {
    const map = new Map<string, Template>();
    templates.forEach((t) => map.set(String(t.id), t));
    return map;
  }, [templates]);

  const reminderDueTemplate = templateById.get(REMINDER_TPL_DUE) || null;
  const reminderMoraTemplate = templateById.get(REMINDER_TPL_MORA) || null;

  const rulesByKey = useMemo(() => {
    const map = new Map<string, Rule>();
    for (const rt of REALTIME_TYPES) {
      const match = rules.find((r) => {
        if (r.trigger !== rt.trigger) return false;
        const types = r.conditions?.requirePaymentTypeIn;
        if (!rt.paymentType) return !types || !types.length;
        return Array.isArray(types) && types.includes(rt.paymentType);
      });
      if (match) map.set(rt.key, match);
    }
    return map;
  }, [rules]);

  const templateForKey = (key: RealtimeKey, chatwootType?: Template["chatwootType"], label?: string) => {
    const rule = rulesByKey.get(key);
    if (rule) {
      const tpl = templateById.get(String(rule.templateId));
      if (tpl) return tpl;
    }
    const found = templates.find((t) => t.chatwootType === chatwootType && t.name === label);
    return found || null;
  };

  const reminderDue = rules.find((r) => r.trigger === "SUBSCRIPTION_DUE" && (!r.conditions?.requirePaymentTypeIn || !r.conditions?.requirePaymentTypeIn?.length) && (r.offsetsSeconds || []).some((s) => Number(s) <= 0));
  const reminderMora = rules.find((r) => r.trigger === "SUBSCRIPTION_DUE" && (r.offsetsSeconds || []).some((s) => Number(s) > 0));

  const [dueOffsets, setDueOffsets] = useState<OffsetItem[]>(offsetsToItems(reminderDue?.offsetsSeconds, -1));
  const [moraOffsets, setMoraOffsets] = useState<OffsetItem[]>(offsetsToItems(reminderMora?.offsetsSeconds, 1));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <h3>Notificaciones en tiempo real</h3>
          </div>
        </div>
        <div className="settings-group-body">
          <div className="saved-connections-grid">
            {REALTIME_TYPES.map((rt) => {
              const tpl = templateForKey(rt.key, rt.chatwootType, rt.label);
              const rule = rulesByKey.get(rt.key);
              const content = tpl?.content && tpl.content !== "(template)" ? String(tpl.content) : "";
              const hasWa = Boolean(tpl?.chatwootTemplate?.name);
              const waName = tpl?.chatwootTemplate?.name || "";
              const waLang = tpl?.chatwootTemplate?.language || "es";
              const waParams = tpl?.chatwootTemplate?.processed_params?.body || [];
              return (
                <div key={rt.key} className="saved-conn-card">
                  <div className="saved-conn-header">
                    <div>
                      <strong>{rt.label}</strong>
                      <div className="saved-conn-sub">Chatwoot</div>
                    </div>
                    <span className={`pill ${rule?.enabled ? "pill-green" : "pill-muted"}`}>{rule?.enabled ? "Activa" : "Inactiva"}</span>
                  </div>
                  <form action={actions.saveRealtime} style={{ display: "grid", gap: 8 }}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="environment" value={env} />
                    <input type="hidden" name="key" value={rt.key} />
                    <input type="hidden" name="chatwootType" value={rt.chatwootType || ""} />
                    <input type="hidden" name="paymentType" value={rt.paymentType || ""} />
                    <div className="field row" style={{ justifyContent: "space-between" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>Activa</span>
                        <HelpTip text="Solo una notificación activa por tipo." />
                      </label>
                      <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} />
                    </div>
                    <div className="field">
                      <label>Tipo de mensaje</label>
                      <select className="select" name="templateKind" defaultValue={hasWa ? "WHATSAPP_TEMPLATE" : "TEXT"}>
                        <option value="TEXT">Texto</option>
                        <option value="WHATSAPP_TEMPLATE">Plantilla WhatsApp</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Mensaje</label>
                      <textarea className="input" name="content" rows={2} defaultValue={content} placeholder="Escribe el mensaje..." />
                    </div>
                    <div className="field">
                      <label>Template WhatsApp</label>
                      <input className="input" name="waTemplateName" defaultValue={waName} placeholder="nombre_template" />
                    </div>
                    <div className="field">
                      <label>Idioma</label>
                      <input className="input" name="waLanguage" defaultValue={waLang} placeholder="es" />
                    </div>
                    <div className="field">
                      <label>Parámetros (separados por |)</label>
                      <input className="input" name="waParams" defaultValue={waParams.map((p) => p.value).join("|")} placeholder="Juan|$10000" />
                    </div>
                    <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                      <PendingButton className="primary" type="submit" pendingText="Guardando...">
                        Guardar
                      </PendingButton>
                    </div>
                  </form>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <h3>Recordatorios programados</h3>
          </div>
        </div>
        <div className="settings-group-body">
          <div className="saved-connections-grid">
            <div className="saved-conn-card">
              <div className="saved-conn-header">
                <div>
                  <strong>Recordatorio de fecha de pago</strong>
                  <div className="saved-conn-sub">Antes del vencimiento</div>
                </div>
              </div>
              <form action={actions.saveReminder} style={{ display: "grid", gap: 8 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="environment" value={env} />
                <input type="hidden" name="kind" value="DUE" />
                <input type="hidden" name="templateId" value={REMINDER_TPL_DUE} />
                <div className="field row" style={{ justifyContent: "space-between" }}>
                  <label>Activa</label>
                  <input type="checkbox" name="enabled" defaultChecked={reminderDue?.enabled ?? true} />
                </div>
                <div className="field">
                  <label>Tipo de mensaje</label>
                  <select className="select" name="templateKind" defaultValue={reminderDueTemplate?.chatwootTemplate?.name ? "WHATSAPP_TEMPLATE" : "TEXT"}>
                    <option value="TEXT">Texto</option>
                    <option value="WHATSAPP_TEMPLATE">Plantilla WhatsApp</option>
                  </select>
                </div>
                <div className="field">
                  <label>Mensaje</label>
                  <textarea className="input" name="content" rows={2} defaultValue={reminderDueTemplate?.content && reminderDueTemplate.content !== "(template)" ? reminderDueTemplate.content : ""} />
                </div>
                <div className="field">
                  <label>Template WhatsApp</label>
                  <input className="input" name="waTemplateName" defaultValue={reminderDueTemplate?.chatwootTemplate?.name || ""} placeholder="nombre_template" />
                </div>
                <div className="field">
                  <label>Idioma</label>
                  <input className="input" name="waLanguage" defaultValue={reminderDueTemplate?.chatwootTemplate?.language || "es"} placeholder="es" />
                </div>
                <div className="field">
                  <label>Parámetros (separados por |)</label>
                  <input
                    className="input"
                    name="waParams"
                    defaultValue={(reminderDueTemplate?.chatwootTemplate?.processed_params?.body || []).map((p) => p.value).join("|")}
                    placeholder="Juan|$10000"
                  />
                </div>
                {dueOffsets.map((item, idx) => (
                  <div key={`due-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
                    <div className="field">
                      <label>Cada</label>
                      <input
                        className="input"
                        value={item.amount}
                        onChange={(e) => {
                          const next = dueOffsets.slice();
                          next[idx] = { ...item, amount: e.target.value };
                          setDueOffsets(next);
                        }}
                        inputMode="numeric"
                      />
                    </div>
                    <div className="field">
                      <label>Unidad</label>
                      <select
                        className="select"
                        value={item.unit}
                        onChange={(e) => {
                          const next = dueOffsets.slice();
                          next[idx] = { ...item, unit: e.target.value as any };
                          setDueOffsets(next);
                        }}
                      >
                        <option value="minutes">Minutos</option>
                        <option value="hours">Horas</option>
                        <option value="days">Días</option>
                      </select>
                    </div>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => setDueOffsets(dueOffsets.filter((_, i) => i !== idx))}
                      aria-label="Eliminar"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                <input type="hidden" name="offsetsSeconds" value={dueOffsets.map((o) => secondsFromOffset(o, -1)).join(",")} />
                <button className="ghost" type="button" onClick={() => setDueOffsets([...dueOffsets, { amount: "1", unit: "days" }])}>
                  + Agregar recordatorio
                </button>
                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                  <PendingButton className="primary" type="submit" pendingText="Guardando...">
                    Guardar
                  </PendingButton>
                </div>
              </form>
            </div>

            <div className="saved-conn-card">
              <div className="saved-conn-header">
                <div>
                  <strong>Recordatorio en mora</strong>
                  <div className="saved-conn-sub">Después del vencimiento</div>
                </div>
              </div>
              <form action={actions.saveReminder} style={{ display: "grid", gap: 8 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="environment" value={env} />
                <input type="hidden" name="kind" value="MORA" />
                <input type="hidden" name="templateId" value={REMINDER_TPL_MORA} />
                <div className="field row" style={{ justifyContent: "space-between" }}>
                  <label>Activa</label>
                  <input type="checkbox" name="enabled" defaultChecked={reminderMora?.enabled ?? true} />
                </div>
                <div className="field">
                  <label>Tipo de mensaje</label>
                  <select className="select" name="templateKind" defaultValue={reminderMoraTemplate?.chatwootTemplate?.name ? "WHATSAPP_TEMPLATE" : "TEXT"}>
                    <option value="TEXT">Texto</option>
                    <option value="WHATSAPP_TEMPLATE">Plantilla WhatsApp</option>
                  </select>
                </div>
                <div className="field">
                  <label>Mensaje</label>
                  <textarea className="input" name="content" rows={2} defaultValue={reminderMoraTemplate?.content && reminderMoraTemplate.content !== "(template)" ? reminderMoraTemplate.content : ""} />
                </div>
                <div className="field">
                  <label>Template WhatsApp</label>
                  <input className="input" name="waTemplateName" defaultValue={reminderMoraTemplate?.chatwootTemplate?.name || ""} placeholder="nombre_template" />
                </div>
                <div className="field">
                  <label>Idioma</label>
                  <input className="input" name="waLanguage" defaultValue={reminderMoraTemplate?.chatwootTemplate?.language || "es"} placeholder="es" />
                </div>
                <div className="field">
                  <label>Parámetros (separados por |)</label>
                  <input
                    className="input"
                    name="waParams"
                    defaultValue={(reminderMoraTemplate?.chatwootTemplate?.processed_params?.body || []).map((p) => p.value).join("|")}
                    placeholder="Juan|$10000"
                  />
                </div>
                {moraOffsets.map((item, idx) => (
                  <div key={`mora-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
                    <div className="field">
                      <label>Cada</label>
                      <input
                        className="input"
                        value={item.amount}
                        onChange={(e) => {
                          const next = moraOffsets.slice();
                          next[idx] = { ...item, amount: e.target.value };
                          setMoraOffsets(next);
                        }}
                        inputMode="numeric"
                      />
                    </div>
                    <div className="field">
                      <label>Unidad</label>
                      <select
                        className="select"
                        value={item.unit}
                        onChange={(e) => {
                          const next = moraOffsets.slice();
                          next[idx] = { ...item, unit: e.target.value as any };
                          setMoraOffsets(next);
                        }}
                      >
                        <option value="minutes">Minutos</option>
                        <option value="hours">Horas</option>
                        <option value="days">Días</option>
                      </select>
                    </div>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => setMoraOffsets(moraOffsets.filter((_, i) => i !== idx))}
                      aria-label="Eliminar"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                <input type="hidden" name="offsetsSeconds" value={moraOffsets.map((o) => secondsFromOffset(o, 1)).join(",")} />
                <button className="ghost" type="button" onClick={() => setMoraOffsets([...moraOffsets, { amount: "1", unit: "days" }])}>
                  + Agregar recordatorio
                </button>
                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                  <PendingButton className="primary" type="submit" pendingText="Guardando...">
                    Guardar
                  </PendingButton>
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
