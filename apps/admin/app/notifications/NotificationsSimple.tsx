"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type ChatwootTemplate = {
  id?: string | number;
  name: string;
  language?: string;
  category?: string;
  status?: string;
  components?: any[];
};

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "SUBSCRIPTION_DUE" | "PAYMENT_LINK_CREATED" | "CATALOG_LINK_CREATED" | "TOKENIZATION_LINK_CREATED" | "PAYMENT_APPROVED" | "PAYMENT_DECLINED";
  templateId: string;
  offsetsSeconds?: number[];
  atTimeUtc?: string | null;
  ensurePaymentLink?: boolean;
  conditions?: {
    requirePaymentTypeIn?: Array<"PLAN" | "SUBSCRIPTION" | "LINK">;
  };
};

type RealtimeKey =
  | "catalog_link_created_plan"
  | "catalog_link_created_subscription"
  | "tokenization_link_created"
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
  aliases?: string[];
  trigger: Rule["trigger"];
  chatwootType: Template["chatwootType"];
  paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK";
}> = [
  { key: "catalog_link_created_plan", label: "Catálogo enviado (link de pago)", trigger: "CATALOG_LINK_CREATED", chatwootType: "PAYMENT_LINK", paymentType: "PLAN" },
  { key: "catalog_link_created_subscription", label: "Catálogo enviado (suscripción · link de pago)", aliases: ["Catálogo enviado (suscripción)"], trigger: "CATALOG_LINK_CREATED", chatwootType: "PAYMENT_LINK", paymentType: "SUBSCRIPTION" },
  { key: "tokenization_link_created", label: "Tokenización enviada (débito automático)", aliases: ["Tokenización enviada"], trigger: "TOKENIZATION_LINK_CREATED", chatwootType: "PAYMENT_LINK" },
  { key: "payment_link_created", label: "Link de pago creado", trigger: "PAYMENT_LINK_CREATED", chatwootType: "PAYMENT_LINK", paymentType: "LINK" },
  { key: "payment_success_subscription", label: "Pago exitoso (débito automático)", aliases: ["Pago exitoso (suscripción)"], trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED", paymentType: "SUBSCRIPTION" },
  { key: "payment_success_plan", label: "Pago exitoso (link de pago)", trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED", paymentType: "PLAN" },
  { key: "payment_success_link", label: "Pago recibido por link de pago", trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED", paymentType: "LINK" },
  { key: "payment_failed_subscription", label: "Pago fallido (débito automático)", aliases: ["Pago fallido (suscripción)"], trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "SUBSCRIPTION" },
  { key: "payment_failed_plan", label: "Pago fallido (link de pago)", trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "PLAN" }
];

const REMINDER_TPL_DUE = "tpl_reminder_due";
const REMINDER_TPL_MORA = "tpl_reminder_mora";

type OffsetItem = { amount: string; unit: "minutes" | "hours" | "days" };
const MESSAGE_VARIABLES = [
  { label: "Nombre completo", value: "{{customer.name}}" },
  { label: "Email", value: "{{customer.email}}" },
  { label: "Teléfono", value: "{{customer.phone}}" },
  { label: "Dirección", value: "{{customer.metadata.address}}" },
  { label: "Link de pago", value: "{{plan.name}}" },
  { label: "Fecha corte", value: "{{subscription.currentPeriodEndAt}}" },
  { label: "Fecha pago", value: "{{payment.paidAt}}" },
  { label: "Referencia", value: "{{payment.reference}}" },
  { label: "Link pago", value: "{{payment.checkoutUrl}}" },
  { label: "Link débito automático", value: "{{tokenization.url}}" },
  { label: "Link catálogo", value: "{{catalog.url}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" }
];

const MESSAGE_EMOJIS = ["✅", "❌", "⏰", "💳", "⚠️", "📌", "📅", "🙏", "🔗", "🧾", "✨"];

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

function isTemplateConfigured(template: Template | null | undefined, kind: "TEXT" | "WHATSAPP_TEMPLATE") {
  if (kind === "WHATSAPP_TEMPLATE") {
    return Boolean(String(template?.chatwootTemplate?.name || "").trim());
  }
  const content = String(template?.content || "").trim();
  return Boolean(content && content !== "(template)");
}

function WaTemplateFields({
  templates,
  defaultName,
  defaultLang,
  defaultParams,
  onSync,
  syncing,
  syncError
}: {
  templates: ChatwootTemplate[];
  defaultName?: string;
  defaultLang?: string;
  defaultParams?: string;
  onSync?: () => void;
  syncing?: boolean;
  syncError?: string;
}) {
  const [name, setName] = useState(defaultName || "");
  const [lang, setLang] = useState(defaultLang || "es");
  const [params, setParams] = useState<string[]>(
    defaultParams ? defaultParams.split("|").map((p) => p.trim()) : []
  );

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.name === name && String(t.language || "es") === String(lang || "es")) || null;
  }, [templates, name, lang]);

  const expectedParamCount = useMemo(() => {
    const comps = selectedTemplate?.components || [];
    let maxIndex = 0;
    for (const c of comps) {
      const text = String((c as any)?.text || "");
      const matches = text.match(/\{\{\d+\}\}/g) || [];
      for (const m of matches) {
        const n = Number(String(m || "").replace(/\D+/g, ""));
        if (Number.isFinite(n)) maxIndex = Math.max(maxIndex, n);
      }
    }
    return Math.max(maxIndex, params.length);
  }, [selectedTemplate, params.length]);

  const onSelect = (value: string) => {
    if (!value) return;
    const [tplName, tplLang] = value.split("::");
    setName(tplName || "");
    setLang(tplLang || "es");
    const tpl = templates.find((t) => t.name === tplName && String(t.language || "es") === String(tplLang || "es"));
    const processed = Array.isArray((tpl as any)?.processed_params?.body)
      ? (tpl as any).processed_params.body.map((p: any) => String(p?.value || ""))
      : [];
    if (processed.length) setParams(processed);
  };

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
        <label>Template WhatsApp</label>
        <input className="input input-compact" name="waTemplateName" value={name} onChange={(e) => setName(e.target.value)} placeholder="nombre_template" />
      </div>
      <div className="field">
        <label>Idioma</label>
        <input className="input input-compact" value={lang} readOnly />
        <input type="hidden" name="waLanguage" value={lang} />
      </div>
      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>Parámetros</span>
          <HelpTip text="Se abren según la plantilla seleccionada. Valores para {{1}}, {{2}}, {{3}}..." />
        </label>
        {expectedParamCount > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {Array.from({ length: expectedParamCount }).map((_, idx) => (
              <select
                key={`param-${idx}`}
                className="select select-compact"
                value={params[idx] || ""}
                onChange={(e) => {
                  const next = params.slice();
                  next[idx] = e.target.value;
                  setParams(next);
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
        ) : (
          <div className="field-hint">Esta plantilla no requiere variables.</div>
        )}
        <input type="hidden" name="waParams" value={params.join("|")} />
      </div>
    </>
  );
}

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
    toggleRule: (formData: FormData) => void;
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

  const templateForKey = (key: RealtimeKey, chatwootType?: Template["chatwootType"], label?: string, aliases?: string[]) => {
    const rule = rulesByKey.get(key);
    if (rule) {
      const tpl = templateById.get(String(rule.templateId));
      if (tpl) return tpl;
    }
    const candidateNames = [label, ...(aliases || [])].filter(Boolean) as string[];
    const found = templates.find((t) => t.chatwootType === chatwootType && candidateNames.includes(t.name));
    return found || null;
  };

  const reminderDue = rules.find((r) => r.trigger === "SUBSCRIPTION_DUE" && (!r.conditions?.requirePaymentTypeIn || !r.conditions?.requirePaymentTypeIn?.length) && (r.offsetsSeconds || []).some((s) => Number(s) <= 0));
  const reminderMora = rules.find((r) => r.trigger === "SUBSCRIPTION_DUE" && (r.offsetsSeconds || []).some((s) => Number(s) > 0));

  const initialRealtimeKinds = useMemo(() => {
    const map: Record<string, "TEXT" | "WHATSAPP_TEMPLATE"> = {};
    for (const rt of REALTIME_TYPES) {
      const tpl = templateForKey(rt.key, rt.chatwootType, rt.label, rt.aliases);
      map[rt.key] = tpl?.chatwootTemplate?.name ? "WHATSAPP_TEMPLATE" : "TEXT";
    }
    return map;
  }, [templates, rules]);

  const [realtimeKinds, setRealtimeKinds] = useState<Record<string, "TEXT" | "WHATSAPP_TEMPLATE">>(initialRealtimeKinds);
  useEffect(() => {
    setRealtimeKinds(initialRealtimeKinds);
  }, [initialRealtimeKinds]);
  const lastFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState<null | "vars" | "emoji">(null);
  const [activeModal, setActiveModal] = useState<
    null | { type: "realtime"; key: RealtimeKey } | { type: "reminder"; kind: "DUE" | "MORA" }
  >(null);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [wizardKind, setWizardKind] = useState<"TEXT" | "WHATSAPP_TEMPLATE">("TEXT");

  const [dueOffsets, setDueOffsets] = useState<OffsetItem[]>(offsetsToItems(reminderDue?.offsetsSeconds, -1));
  const [moraOffsets, setMoraOffsets] = useState<OffsetItem[]>(offsetsToItems(reminderMora?.offsetsSeconds, 1));
  const [dueKind, setDueKind] = useState<"TEXT" | "WHATSAPP_TEMPLATE">(reminderDueTemplate?.chatwootTemplate?.name ? "WHATSAPP_TEMPLATE" : "TEXT");
  const [moraKind, setMoraKind] = useState<"TEXT" | "WHATSAPP_TEMPLATE">(reminderMoraTemplate?.chatwootTemplate?.name ? "WHATSAPP_TEMPLATE" : "TEXT");

  const [waTemplates, setWaTemplates] = useState<ChatwootTemplate[]>([]);
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState("");
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
    loadWaTemplates();
  }, [loadWaTemplates, env]);

  useEffect(() => {
    setDueKind(reminderDueTemplate?.chatwootTemplate?.name ? "WHATSAPP_TEMPLATE" : "TEXT");
  }, [reminderDueTemplate?.chatwootTemplate?.name]);

  useEffect(() => {
    setMoraKind(reminderMoraTemplate?.chatwootTemplate?.name ? "WHATSAPP_TEMPLATE" : "TEXT");
  }, [reminderMoraTemplate?.chatwootTemplate?.name]);

  function onPickValue(value: string) {
    if (lastFieldRef.current) insertAtCursor(lastFieldRef.current, value);
    setPickerOpen(null);
  }

  const pendingRealtime = REALTIME_TYPES;
  const dueConfigured = Boolean(reminderDue && isTemplateConfigured(reminderDueTemplate, dueKind));
  const moraConfigured = Boolean(reminderMora && isTemplateConfigured(reminderMoraTemplate, moraKind));

  useEffect(() => {
    if (!activeModal) return;
    setWizardStep(1);
    if (activeModal.type === "realtime") {
      const rt = REALTIME_TYPES.find((r) => r.key === activeModal.key);
      if (!rt) return;
      const tpl = templateForKey(rt.key, rt.chatwootType, rt.label, rt.aliases);
      const hasWa = Boolean(tpl?.chatwootTemplate?.name);
      const kind = realtimeKinds[rt.key] || (hasWa ? "WHATSAPP_TEMPLATE" : "TEXT");
      setWizardKind(kind);
      return;
    }
    const kind = activeModal.kind === "DUE" ? dueKind : moraKind;
    setWizardKind(kind);
  }, [activeModal]);
  const listItems = [
    ...pendingRealtime.map((rt) => {
      const rule = rulesByKey.get(rt.key);
      const tpl = templateForKey(rt.key, rt.chatwootType, rt.label, rt.aliases);
      const hasWa = Boolean(tpl?.chatwootTemplate?.name);
      const kind = realtimeKinds[rt.key] || (hasWa ? "WHATSAPP_TEMPLATE" : "TEXT");
      const kindLabel = kind === "WHATSAPP_TEMPLATE" ? "Plantilla" : "Mensaje";
      const isConfigured = Boolean(rule);
      const statusLabel = isConfigured ? (rule?.enabled ? "Activa" : "Inactiva") : "No configurada";
      const statusPill = isConfigured ? (rule?.enabled ? "pill-green" : "pill-muted") : "pill-muted";
      return {
        id: `realtime:${rt.key}`,
        label: rt.label,
        subtitle: kindLabel,
        statusLabel,
        statusPill,
        ruleId: rule?.id || "",
        enabled: Boolean(rule?.enabled),
        onClick: () => setActiveModal({ type: "realtime", key: rt.key })
      };
    }),
    {
      id: "reminder:due",
      label: "Recordatorio de fecha de pago",
      subtitle: "Antes del vencimiento",
      statusLabel: dueConfigured ? (reminderDue?.enabled ? "Activa" : "Inactiva") : "No configurada",
      statusPill: dueConfigured && reminderDue?.enabled ? "pill-green" : "pill-muted",
      ruleId: reminderDue?.id || "",
      enabled: Boolean(reminderDue?.enabled),
      onClick: () => setActiveModal({ type: "reminder", kind: "DUE" })
    },
    {
      id: "reminder:mora",
      label: "Recordatorio en mora",
      subtitle: "Después del vencimiento",
      statusLabel: moraConfigured ? (reminderMora?.enabled ? "Activa" : "Inactiva") : "No configurada",
      statusPill: moraConfigured && reminderMora?.enabled ? "pill-green" : "pill-muted",
      ruleId: reminderMora?.id || "",
      enabled: Boolean(reminderMora?.enabled),
      onClick: () => setActiveModal({ type: "reminder", kind: "MORA" })
    }
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="panelHeaderRow" style={{ justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Notificaciones</h3>
          <HelpTip text="Crea notificaciones personalizadas por evento y configura los recordatorios automáticos." />
        </div>
      </div>
      {pickerOpen ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 640 }}>
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>{pickerOpen === "vars" ? "Variables" : "Emojis"}</h3>
              <button type="button" className="ghost modal-close" onClick={() => setPickerOpen(null)} aria-label="Cerrar" data-modal-close="true" data-loader="off">X</button>
            </div>
            <div className="panel module" style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(pickerOpen === "vars" ? MESSAGE_VARIABLES : MESSAGE_EMOJIS).map((item) => {
                  const label = typeof item === "string" ? item : item.label;
                  const value = typeof item === "string" ? item : item.value;
                  return (
                    <button key={value} type="button" className="ghost" onClick={() => onPickValue(value)} style={{ minHeight: 32 }} data-loader="off">
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <section className="settings-group notifications-templates-section">
        <div className="settings-group-header">
          <div className="panelHeaderRow" style={{ justifyContent: "space-between", gap: 8 }}>
            <h3>Lista de notificaciones</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="ghost btn-compact" type="button" onClick={loadWaTemplates} data-loader="off">
                {waLoading ? "Sincronizando..." : "Sincronizar plantillas WhatsApp"}
              </button>
              {waError ? <span className="muted" style={{ fontSize: 12 }}>{waError}</span> : null}
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <div style={{ display: "grid", gap: 8 }}>
            {listItems.map((item) => (
              <div
                key={item.id}
                className="card cardPad"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px" }}
              >
                <div>
                  <strong>{item.label}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>{item.subtitle}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className={`pill ${item.statusPill}`}>{item.statusLabel}</span>
                  {item.ruleId ? (
                    <form
                      action={actions.toggleRule}
                      onChange={(e) => {
                        const form = (e.currentTarget as HTMLFormElement) || null;
                        form?.requestSubmit();
                      }}
                    >
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="environment" value={env} />
                      <input type="hidden" name="ruleId" value={item.ruleId} />
                      <input type="hidden" name="enabled" value={item.enabled ? "0" : "1"} />
                      <label className="toggleControl" aria-label={item.enabled ? "Apagar" : "Prender"}>
                        <input className="toggleInput" type="checkbox" defaultChecked={item.enabled} />
                        <span className="toggle" aria-hidden="true" />
                      </label>
                    </form>
                  ) : null}
                  <button className="primary btn-compact" type="button" onClick={item.onClick} data-loader="off">
                    Configurar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {activeModal ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 900 }}>
            <div className="panel-header ui-panel-header">
              <strong>
                {activeModal.type === "realtime"
                  ? "Configurar notificación"
                  : activeModal.kind === "DUE"
                    ? "Configurar recordatorio de fecha de pago"
                    : "Configurar recordatorio en mora"}
              </strong>
              <button className="ghost modal-close" type="button" onClick={() => setActiveModal(null)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <div className="modal-body">
              {activeModal.type === "realtime" ? (
                (() => {
                  const rt = REALTIME_TYPES.find((r) => r.key === activeModal.key);
                  if (!rt) return null;
                  const tpl = templateForKey(rt.key, rt.chatwootType, rt.label, rt.aliases);
                  const rule = rulesByKey.get(rt.key);
                  const content = tpl?.content && tpl.content !== "(template)" ? String(tpl.content) : "";
                  const hasWa = Boolean(tpl?.chatwootTemplate?.name);
                  const waName = tpl?.chatwootTemplate?.name || "";
                  const waLang = tpl?.chatwootTemplate?.language || "es";
                  const waParams = tpl?.chatwootTemplate?.processed_params?.body || [];
                  const kind = wizardKind;
                  return (
                    <form action={actions.saveRealtime} className="notification-form" style={{ display: "grid", gap: 10 }}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="environment" value={env} />
                      <input type="hidden" name="key" value={rt.key} />
                      <input type="hidden" name="chatwootType" value={rt.chatwootType || ""} />
                      <input type="hidden" name="paymentType" value={rt.paymentType || ""} />
                      <input type="hidden" name="templateKind" value={kind} />
                      <input type="hidden" name="enabled" value={(rule?.enabled ?? true) ? "on" : ""} />
                      {wizardStep === 1 ? (
                        <div className="field">
                          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span>Paso 1: tipo de mensaje</span>
                            <HelpTip text="Selecciona si usarás un mensaje libre o una plantilla de WhatsApp." />
                          </label>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              className="ghost btn-compact"
                              type="button"
                              onClick={() => {
                                setWizardKind("TEXT");
                                setRealtimeKinds({ ...realtimeKinds, [rt.key]: "TEXT" });
                                setWizardStep(2);
                              }}
                              data-loader="off"
                            >
                              Mensaje
                            </button>
                            <button
                              className="ghost btn-compact"
                              type="button"
                              onClick={() => {
                                setWizardKind("WHATSAPP_TEMPLATE");
                                setRealtimeKinds({ ...realtimeKinds, [rt.key]: "WHATSAPP_TEMPLATE" });
                                setWizardStep(2);
                              }}
                              data-loader="off"
                            >
                              Plantilla
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="field row" style={{ justifyContent: "space-between" }}>
                          <div className="muted">Tipo: {kind === "WHATSAPP_TEMPLATE" ? "Plantilla" : "Mensaje"}</div>
                          <button className="ghost btn-compact" type="button" onClick={() => setWizardStep(1)} data-loader="off">
                            Cambiar tipo
                          </button>
                        </div>
                      )}
                      {wizardStep === 2 && kind === "TEXT" ? (
                        <div className="field">
                          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span>Mensaje</span>
                            <HelpTip text="Puedes usar variables del sistema, por ejemplo: {{customer.name}}, {{customer.email}}, {{plan.name}}, {{payment.checkoutUrl}}, {{tokenization.url}}, {{catalog.url}}, {{subscription.currentPeriodEndAt}}." />
                          </label>
                          <textarea
                            className="input input-compact"
                            name="content"
                            rows={2}
                            defaultValue={content}
                            placeholder="Escribe el mensaje..."
                            onFocus={(e) => (lastFieldRef.current = e.target)}
                            onInput={(e) => autoResizeTextarea(e.currentTarget)}
                          />
                          <div className="field-hint">Se reemplazan variables del sistema automáticamente.</div>
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <button type="button" className="ghost btn-compact" data-modal="true" onClick={() => setPickerOpen("vars")} aria-label="Variables" data-loader="off">
                              {`{ }`}
                            </button>
                            <button type="button" className="ghost btn-compact" data-modal="true" onClick={() => setPickerOpen("emoji")} aria-label="Emojis" data-loader="off">
                              🙂
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {wizardStep === 2 && kind === "WHATSAPP_TEMPLATE" ? (
                        <WaTemplateFields
                          templates={waTemplates}
                          defaultName={waName}
                          defaultLang={waLang}
                          defaultParams={waParams.map((p) => p.value).join("|")}
                        />
                      ) : null}
                      {wizardStep === 2 ? (
                        <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
                            Guardar
                          </PendingButton>
                        </div>
                      ) : null}
                    </form>
                  );
                })()
              ) : null}
              {activeModal.type === "reminder" ? (
                <form action={actions.saveReminder} className="notification-form" style={{ display: "grid", gap: 10 }}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="environment" value={env} />
                  <input type="hidden" name="kind" value={activeModal.kind} />
                  <input type="hidden" name="templateId" value={activeModal.kind === "DUE" ? REMINDER_TPL_DUE : REMINDER_TPL_MORA} />
                  <input type="hidden" name="templateKind" value={wizardKind} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={((activeModal.kind === "DUE" ? reminderDue : reminderMora)?.enabled ?? true) ? "on" : ""}
                  />
                  {wizardStep === 1 ? (
                    <div className="field">
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>Paso 1: tipo de mensaje</span>
                        <HelpTip text="Selecciona si usarás un mensaje libre o una plantilla de WhatsApp." />
                      </label>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className="ghost btn-compact"
                          type="button"
                          onClick={() => {
                            setWizardKind("TEXT");
                            activeModal.kind === "DUE" ? setDueKind("TEXT") : setMoraKind("TEXT");
                            setWizardStep(2);
                          }}
                          data-loader="off"
                        >
                          Mensaje
                        </button>
                        <button
                          className="ghost btn-compact"
                          type="button"
                          onClick={() => {
                            setWizardKind("WHATSAPP_TEMPLATE");
                            activeModal.kind === "DUE" ? setDueKind("WHATSAPP_TEMPLATE") : setMoraKind("WHATSAPP_TEMPLATE");
                            setWizardStep(2);
                          }}
                          data-loader="off"
                        >
                          Plantilla
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="field row" style={{ justifyContent: "space-between" }}>
                      <div className="muted">Tipo: {wizardKind === "WHATSAPP_TEMPLATE" ? "Plantilla" : "Mensaje"}</div>
                      <button className="ghost btn-compact" type="button" onClick={() => setWizardStep(1)} data-loader="off">
                        Cambiar tipo
                      </button>
                    </div>
                  )}
                  {wizardStep === 2 && wizardKind === "TEXT" ? (
                    <div className="field">
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>Mensaje</span>
                        <HelpTip text="Puedes usar variables del sistema, por ejemplo: {{customer.name}}, {{customer.email}}, {{plan.name}}, {{payment.checkoutUrl}}, {{tokenization.url}}, {{catalog.url}}, {{subscription.currentPeriodEndAt}}." />
                      </label>
                      <textarea
                        className="input input-compact"
                        name="content"
                        rows={2}
                        defaultValue={
                          activeModal.kind === "DUE"
                            ? (reminderDueTemplate?.content && reminderDueTemplate.content !== "(template)" ? reminderDueTemplate.content : "")
                            : (reminderMoraTemplate?.content && reminderMoraTemplate.content !== "(template)" ? reminderMoraTemplate.content : "")
                        }
                        onFocus={(e) => (lastFieldRef.current = e.target)}
                        onInput={(e) => autoResizeTextarea(e.currentTarget)}
                      />
                      <div className="field-hint">Se reemplazan variables del sistema automáticamente.</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button type="button" className="ghost btn-compact" data-modal="true" onClick={() => setPickerOpen("vars")} aria-label="Variables" data-loader="off">
                          {`{ }`}
                        </button>
                        <button type="button" className="ghost btn-compact" data-modal="true" onClick={() => setPickerOpen("emoji")} aria-label="Emojis" data-loader="off">
                          🙂
                        </button>
                      </div>
                    </div>
                  ) : wizardStep === 2 ? (
                    <WaTemplateFields
                      templates={waTemplates}
                      defaultName={activeModal.kind === "DUE" ? (reminderDueTemplate?.chatwootTemplate?.name || "") : (reminderMoraTemplate?.chatwootTemplate?.name || "")}
                      defaultLang={activeModal.kind === "DUE" ? (reminderDueTemplate?.chatwootTemplate?.language || "es") : (reminderMoraTemplate?.chatwootTemplate?.language || "es")}
                      defaultParams={
                        activeModal.kind === "DUE"
                          ? (reminderDueTemplate?.chatwootTemplate?.processed_params?.body || []).map((p) => p.value).join("|")
                          : (reminderMoraTemplate?.chatwootTemplate?.processed_params?.body || []).map((p) => p.value).join("|")
                      }
                    />
                  ) : null}
                  {wizardStep === 2 ? (
                    <>
                      {(activeModal.kind === "DUE" ? dueOffsets : moraOffsets).map((item, idx) => (
                        <div key={`${activeModal.kind}-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, alignItems: "end" }}>
                          <div className="field">
                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span>Cada</span>
                              <HelpTip text="Cantidad del recordatorio." />
                            </label>
                            <input
                              className="input input-compact"
                              value={item.amount}
                              onChange={(e) => {
                                const next = (activeModal.kind === "DUE" ? dueOffsets : moraOffsets).slice();
                                next[idx] = { ...item, amount: e.target.value };
                                activeModal.kind === "DUE" ? setDueOffsets(next) : setMoraOffsets(next);
                              }}
                              inputMode="numeric"
                            />
                          </div>
                          <div className="field">
                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span>Unidad</span>
                              <HelpTip text="Unidad de tiempo del recordatorio." />
                            </label>
                            <select
                              className="select select-compact"
                              value={item.unit}
                              onChange={(e) => {
                                const next = (activeModal.kind === "DUE" ? dueOffsets : moraOffsets).slice();
                                next[idx] = { ...item, unit: e.target.value as any };
                                activeModal.kind === "DUE" ? setDueOffsets(next) : setMoraOffsets(next);
                              }}
                            >
                              <option value="minutes">Minutos</option>
                              <option value="hours">Horas</option>
                              <option value="days">Días</option>
                            </select>
                          </div>
                          <button
                            className="ghost btn-compact"
                            type="button"
                            onClick={() => {
                              const next = (activeModal.kind === "DUE" ? dueOffsets : moraOffsets).filter((_, i) => i !== idx);
                              activeModal.kind === "DUE" ? setDueOffsets(next) : setMoraOffsets(next);
                            }}
                            aria-label="Eliminar"
                            data-loader="off"
                          >
                            Quitar
                          </button>
                        </div>
                      ))}
                      <input
                        type="hidden"
                        name="offsetsSeconds"
                        value={(activeModal.kind === "DUE" ? dueOffsets : moraOffsets)
                          .map((o) => secondsFromOffset(o, activeModal.kind === "DUE" ? -1 : 1))
                          .join(",")}
                      />
                      <button
                        className="ghost btn-compact"
                        type="button"
                        onClick={() =>
                          activeModal.kind === "DUE"
                            ? setDueOffsets([...dueOffsets, { amount: "1", unit: "days" }])
                            : setMoraOffsets([...moraOffsets, { amount: "1", unit: "days" }])
                        }
                        data-loader="off"
                      >
                        + Agregar recordatorio
                      </button>
                      <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                        <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
                          Guardar
                        </PendingButton>
                      </div>
                    </>
                  ) : null}
                </form>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
