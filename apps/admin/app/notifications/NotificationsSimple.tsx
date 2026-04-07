"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";
import { AppModal } from "../ui/AppModal";

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
    processed_params?: {
      body?: Array<{ key: string; value: string }>;
      header?: Array<{ key: string; value: string }>;
      buttons?: Array<{ index?: string | number; key?: string; value?: string }>;
    };
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

type PublicCheckoutTemplate = {
  id: string;
  name: string;
  kind?: string | null;
  active?: boolean | null;
  expiryHours?: number | null;
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
  checkoutTemplateId?: string | null;
  conditions?: {
    requirePaymentTypeIn?: Array<"PLAN" | "SUBSCRIPTION" | "LINK">;
  };
};

type RealtimeKey =
  | "catalog_link_created_plan"
  | "catalog_link_created_subscription"
  | "tokenization_link_created"
  | "payment_link_created"
  | "payment_link_created_subscription"
  | "payment_success"
  | "payment_failed_link"
  | "payment_failed_subscription";

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
  { key: "payment_link_created_subscription", label: "Link de pago creado (suscripción)", trigger: "PAYMENT_LINK_CREATED", chatwootType: "PAYMENT_LINK", paymentType: "SUBSCRIPTION" },
  { key: "payment_success", label: "Pago exitoso", trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED" },
  { key: "payment_failed_link", label: "Pago fallido (link de pago)", trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "LINK" },
  { key: "payment_failed_subscription", label: "Pago fallido (débito automático)", trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "SUBSCRIPTION" }
];

const REMINDER_TPL_DUE_LINK = "tpl_reminder_due_link";
const REMINDER_TPL_DUE_SUBSCRIPTION = "tpl_reminder_due_subscription";
const REMINDER_TPL_MORA_LINK = "tpl_reminder_mora_link";
const REMINDER_TPL_MORA_SUBSCRIPTION = "tpl_reminder_mora_subscription";

const REMINDER_TYPES = [
  { key: "reminder_due_link", kind: "DUE", paymentType: "LINK", label: "Recordatorio fecha de pago (link de pago)", templateId: REMINDER_TPL_DUE_LINK },
  { key: "reminder_due_subscription", kind: "DUE", paymentType: "SUBSCRIPTION", label: "Recordatorio fecha de pago (débito automático)", templateId: REMINDER_TPL_DUE_SUBSCRIPTION },
  { key: "reminder_mora_link", kind: "MORA", paymentType: "LINK", label: "Recordatorio en mora (link de pago)", templateId: REMINDER_TPL_MORA_LINK },
  { key: "reminder_mora_subscription", kind: "MORA", paymentType: "SUBSCRIPTION", label: "Recordatorio en mora (débito automático)", templateId: REMINDER_TPL_MORA_SUBSCRIPTION }
] as const;

type OffsetItem = { amount: string; unit: "minutes" | "hours" | "days" };
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
  { label: "Ciclo activo", value: "{{subscription.activeCycleNumber}}" },
  { label: "Inicio del ciclo activo", value: "{{subscription.activeCycleStartAt}}" },
  { label: "Fin del ciclo activo", value: "{{subscription.activeCycleEndAt}}" },
  { label: "Ciclo de cobro", value: "{{subscription.collectionCycleNumber}}" },
  { label: "Próximo cobro", value: "{{subscription.nextBillingDate}}" },
  { label: "Fecha de pago", value: "{{payment.paidAt}}" },
  { label: "Fecha de creación del pago", value: "{{payment.createdAt}}" },
  { label: "Fecha de fallo del pago", value: "{{payment.failedAt}}" },
  { label: "Recurrencia · cada (cantidad)", value: "{{plan.intervalCount}}" },
  { label: "Recurrencia · unidad", value: "{{plan.intervalUnit}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

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

function isTemplateConfigured(template: Template | null | undefined) {
  return Boolean(String(template?.chatwootTemplate?.name || "").trim());
}

function WaTemplateFields({
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
  variables: Array<{ label: string; value: string }>;
  buttonVariables: Array<{ label: string; value: string }>;
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
      <input type="hidden" name="waTemplateName" value={name} />
      <input type="hidden" name="waLanguage" value={lang} />
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
                    {buttonVariables.map((v) => (
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
        <input type="hidden" name="waParams" value={bodyParams.join("|")} />
        <input type="hidden" name="waBodyParams" value={bodyParams.join("|")} />
        <input type="hidden" name="waHeaderParams" value={headerParams.join("|")} />
        <input type="hidden" name="waButtonParams" value={buttonParams.join("|")} />
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
  checkoutTemplates,
  paymentsConfig,
  actions
}: {
  env: Env;
  csrfToken: string;
  templates: Template[];
  rules: Rule[];
  checkoutTemplates: PublicCheckoutTemplate[];
  paymentsConfig?: { notifyWhatsappForUnlinkedPayments?: boolean | null } | null;
  actions: {
    saveRealtime: (formData: FormData) => void;
    saveReminder: (formData: FormData) => void;
    toggleRule: (formData: FormData) => void;
    updatePaymentsConfig: (formData: FormData) => void;
  };
}) {
  const templateById = useMemo(() => {
    const map = new Map<string, Template>();
    templates.forEach((t) => map.set(String(t.id), t));
    return map;
  }, [templates]);

  const reminderTemplateById = useMemo(() => {
    return {
      dueLink: templateById.get(REMINDER_TPL_DUE_LINK) || null,
      dueSubscription: templateById.get(REMINDER_TPL_DUE_SUBSCRIPTION) || null,
      moraLink: templateById.get(REMINDER_TPL_MORA_LINK) || null,
      moraSubscription: templateById.get(REMINDER_TPL_MORA_SUBSCRIPTION) || null
    };
  }, [templateById]);

  const rulesByKey = useMemo(() => {
    const map = new Map<string, Rule>();
    for (const rt of REALTIME_TYPES) {
      const match = rules.find((r) => {
        if (r.trigger !== rt.trigger) return false;
        const types = r.conditions?.requirePaymentTypeIn;
        if (!rt.paymentType) return !types || !types.length;
        if (Array.isArray(types) && types.includes(rt.paymentType)) return true;
        if (rt.trigger === "PAYMENT_DECLINED" && rt.paymentType === "LINK" && (!types || !types.length)) return true;
        return false;
      });
      const fallback = !match && !rt.paymentType ? rules.find((r) => r.trigger === rt.trigger) : null;
      if (match) map.set(rt.key, match);
      else if (fallback) map.set(rt.key, fallback);
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

  const findReminderRule = (kind: "DUE" | "MORA", paymentType: "LINK" | "SUBSCRIPTION") => {
    return rules.find((r) => {
      if (r.trigger !== "SUBSCRIPTION_DUE") return false;
      const offsets = r.offsetsSeconds || [];
      const isDue = offsets.some((s) => Number(s) <= 0);
      const isMora = offsets.some((s) => Number(s) > 0);
      if (kind === "DUE" && !isDue) return false;
      if (kind === "MORA" && !isMora) return false;
      const types = r.conditions?.requirePaymentTypeIn;
      if (paymentType === "SUBSCRIPTION") return Array.isArray(types) && types.includes("SUBSCRIPTION");
      if (!types || !types.length) return true;
      return Array.isArray(types) && types.includes("LINK");
    });
  };

  const reminderRuleByKey = useMemo(() => {
    return {
      dueLink: findReminderRule("DUE", "LINK"),
      dueSubscription: findReminderRule("DUE", "SUBSCRIPTION"),
      moraLink: findReminderRule("MORA", "LINK"),
      moraSubscription: findReminderRule("MORA", "SUBSCRIPTION")
    };
  }, [rules]);

  const lastFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState<null | "vars">(null);
  const [activeModal, setActiveModal] = useState<
    null | { type: "realtime"; key: RealtimeKey } | { type: "reminder"; kind: "DUE" | "MORA"; paymentType: "LINK" | "SUBSCRIPTION" }
  >(null);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [reminderOffsets, setReminderOffsets] = useState<OffsetItem[]>([]);

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

  const getReminderTemplate = (kind: "DUE" | "MORA", paymentType: "LINK" | "SUBSCRIPTION") => {
    if (kind === "DUE" && paymentType === "LINK") return reminderTemplateById.dueLink;
    if (kind === "DUE") return reminderTemplateById.dueSubscription;
    if (kind === "MORA" && paymentType === "LINK") return reminderTemplateById.moraLink;
    return reminderTemplateById.moraSubscription;
  };

  const getReminderRule = (kind: "DUE" | "MORA", paymentType: "LINK" | "SUBSCRIPTION") => {
    if (kind === "DUE" && paymentType === "LINK") return reminderRuleByKey.dueLink;
    if (kind === "DUE") return reminderRuleByKey.dueSubscription;
    if (kind === "MORA" && paymentType === "LINK") return reminderRuleByKey.moraLink;
    return reminderRuleByKey.moraSubscription;
  };

  function onPickValue(value: string) {
    if (lastFieldRef.current) insertAtCursor(lastFieldRef.current, value);
    setPickerOpen(null);
  }

  const pendingRealtime = REALTIME_TYPES;
  const autoCheckoutVars = useMemo(
    () => [{ label: "Checkout público (Automático)", value: "{{checkoutPublicToken.AUTO}}" }],
    []
  );
  const autoUrlVars = useMemo(
    () => [
      { label: "Link público (Automático · Plan)", value: "{{checkoutPublicUrl.AUTO_PLAN}}" },
      { label: "Link público (Automático · Suscripción)", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" },
      { label: "Link público (Automático · Catálogo)", value: "{{checkoutPublicUrl.AUTO_CART}}" }
    ],
    []
  );
  const bodyVars = useMemo(() => [...MESSAGE_VARIABLES, ...autoUrlVars], [autoUrlVars]);
  const buttonVars = useMemo(
    () => [...autoCheckoutVars],
    [autoCheckoutVars]
  );

  useEffect(() => {
    if (!activeModal) return;
    setWizardStep(1);
    if (activeModal.type === "realtime") {
      const rt = REALTIME_TYPES.find((r) => r.key === activeModal.key);
      if (!rt) return;
      templateForKey(rt.key, rt.chatwootType, rt.label, rt.aliases);
      setWizardStep(2);
      return;
    }
    const rule = getReminderRule(activeModal.kind, activeModal.paymentType);
    const tpl = getReminderTemplate(activeModal.kind, activeModal.paymentType);
    const isDue = activeModal.kind === "DUE";
    const offsets = offsetsToItems(rule?.offsetsSeconds, isDue ? -1 : 1);
    setReminderOffsets(offsets);
    setWizardStep(2);
  }, [activeModal]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const open = String(params.get("open") || "").trim();
    if (!open) return;
    const key = open as RealtimeKey;
    const exists = REALTIME_TYPES.some((r) => r.key === key);
    if (exists) {
      setActiveModal({ type: "realtime", key });
    }
  }, []);
  const listItems = [
    ...pendingRealtime.map((rt) => {
      const rule = rulesByKey.get(rt.key);
      const tpl = templateForKey(rt.key, rt.chatwootType, rt.label, rt.aliases);
      const kindLabel = "Plantilla";
      const isConfigured = Boolean(rule && tpl?.chatwootTemplate?.name);
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
    ...REMINDER_TYPES.map((rt) => {
      const rule = getReminderRule(rt.kind, rt.paymentType);
      const tpl = getReminderTemplate(rt.kind, rt.paymentType);
      const kindLabel = "Plantilla";
      const isConfigured = Boolean(rule && isTemplateConfigured(tpl));
      const statusLabel = isConfigured ? (rule?.enabled ? "Activa" : "Inactiva") : "No configurada";
      const statusPill = isConfigured && rule?.enabled ? "pill-green" : "pill-muted";
      return {
        id: `reminder:${rt.key}`,
        label: rt.label,
        subtitle: rt.kind === "DUE" ? "Antes del vencimiento" : "Después del vencimiento",
        statusLabel,
        statusPill,
        ruleId: rule?.id || "",
        enabled: Boolean(rule?.enabled),
        onClick: () => setActiveModal({ type: "reminder", kind: rt.kind, paymentType: rt.paymentType })
      };
    })
  ];

  const getReminderTemplateId = (kind: "DUE" | "MORA", paymentType: "LINK" | "SUBSCRIPTION") => {
    if (kind === "DUE" && paymentType === "LINK") return REMINDER_TPL_DUE_LINK;
    if (kind === "DUE") return REMINDER_TPL_DUE_SUBSCRIPTION;
    if (kind === "MORA" && paymentType === "LINK") return REMINDER_TPL_MORA_LINK;
    return REMINDER_TPL_MORA_SUBSCRIPTION;
  };

  const activeReminder =
    activeModal?.type === "reminder"
      ? {
          rule: getReminderRule(activeModal.kind, activeModal.paymentType),
          template: getReminderTemplate(activeModal.kind, activeModal.paymentType),
          templateId: getReminderTemplateId(activeModal.kind, activeModal.paymentType)
        }
      : null;
  const activeModalTitle = (() => {
    if (!activeModal) return "";
    if (activeModal.type === "realtime") {
      const rt = REALTIME_TYPES.find((r) => r.key === activeModal.key);
      return rt ? `Notificación: ${rt.label}` : "Configurar notificación";
    }
    return activeModal.kind === "DUE" ? "Recordatorio: Fecha de pago" : "Recordatorio: Mora";
  })();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="settings-group-header">
        <div className="settings-group-header-main">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3>Notificaciones WhatsApp</h3>
            <HelpTip text="Crea notificaciones personalizadas por evento y configura los recordatorios automáticos." />
          </div>
        </div>
      </div>
      <AppModal
        open={Boolean(pickerOpen)}
        onClose={() => setPickerOpen(null)}
        title={pickerOpen === "vars" ? "Variables" : "Emojis"}
        maxWidth={640}
      >
        <div className="panel module" style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[...MESSAGE_VARIABLES, ...autoCheckoutVars].map((item) => {
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
      </AppModal>
      <section className="settings-group notifications-templates-section">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <h3>Lista de notificaciones</h3>
          </div>
          <div className="settings-group-header-actions">
            <button className="ghost btn-compact" type="button" onClick={loadWaTemplates} data-loader="off">
              {waLoading ? "Sincronizando..." : "Sincronizar plantillas WhatsApp"}
            </button>
            {waError ? <span className="muted" style={{ fontSize: 12 }}>{waError}</span> : null}
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
                      data-loader="off"
                    >
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="environment" value={env} />
                      <input type="hidden" name="ruleId" value={item.ruleId} />
                      <input type="hidden" name="enabled" value={item.enabled ? "0" : "1"} />
                      <label className="toggleControl" aria-label={item.enabled ? "Apagar" : "Prender"} data-loader="off">
                        <input className="toggleInput" type="checkbox" defaultChecked={item.enabled} data-loader="off" />
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

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Pagos externos</h3>
              <HelpTip text="Controla si se notifican pagos sin suscripción asociada." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <form
            action={actions.updatePaymentsConfig}
            className="panel module"
            style={{ display: "grid", gap: 12 }}
            onChange={(e) => {
              const form = (e.currentTarget as HTMLFormElement) || null;
              form?.requestSubmit();
            }}
            data-loader="off"
          >
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="returnTo" value="/notifications" />
            <div className="toggleRow">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Notificar pagos externos</strong>
                </div>
                <div className="field-hint">Aplica a pagos sin suscripción activa o no asociados.</div>
              </div>
              <label className="toggleControl" aria-label="Notificar pagos externos">
                <input type="hidden" name="notifyWhatsappForUnlinkedPayments" value="0" />
                <input
                  className="toggleInput"
                  type="checkbox"
                  name="notifyWhatsappForUnlinkedPayments"
                  value="1"
                  defaultChecked={Boolean(paymentsConfig?.notifyWhatsappForUnlinkedPayments ?? true)}
                  data-loader="off"
                />
                <span className="toggle" aria-hidden="true" />
              </label>
            </div>
          </form>
        </div>
      </section>
      <AppModal
        open={Boolean(activeModal)}
        onClose={() => setActiveModal(null)}
        title={activeModalTitle}
        maxWidth={900}
      >
        {activeModal?.type === "realtime" ? (
          (() => {
            const rt = REALTIME_TYPES.find((r) => r.key === activeModal.key);
            if (!rt) return null;
            const tpl = templateForKey(rt.key, rt.chatwootType, rt.label, rt.aliases);
            const rule = rulesByKey.get(rt.key);
            const waName = tpl?.chatwootTemplate?.name || "";
            const waLang = tpl?.chatwootTemplate?.language || "es";
            const waBodyParams = tpl?.chatwootTemplate?.processed_params?.body || [];
            const waHeaderParams = tpl?.chatwootTemplate?.processed_params?.header || [];
            const waButtonParams = tpl?.chatwootTemplate?.processed_params?.buttons || [];
            return (
              <form action={actions.saveRealtime} className="notification-form" style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="environment" value={env} />
                <input type="hidden" name="key" value={rt.key} />
                <input type="hidden" name="chatwootType" value={rt.chatwootType || ""} />
                <input type="hidden" name="paymentType" value={rt.paymentType || ""} />
                <input type="hidden" name="templateKind" value="WHATSAPP_TEMPLATE" />
                <input type="hidden" name="enabled" value={(rule?.enabled ?? true) ? "on" : ""} />
                <div className="field row" style={{ justifyContent: "space-between" }}>
                  <div className="muted">Tipo: Plantilla (WhatsApp)</div>
                </div>
                <WaTemplateFields
                  templates={waTemplates}
                  defaultName={waName}
                  defaultLang={waLang}
                  defaultParams={waBodyParams.map((p) => p.value).join("|")}
                  defaultHeaderParams={waHeaderParams.map((p) => p.value).join("|")}
                  defaultButtonParams={waButtonParams.map((p) => p.value).join("|")}
                  variables={bodyVars}
                  buttonVariables={buttonVars}
                />
                <div className="module-footer">
                  <button
                    className="ghost btn-compact btn-cancel"
                    type="button"
                    onClick={() => setActiveModal(null)}
                    data-modal-close="true"
                    data-loader="off"
                    title="Cerrar sin guardar"
                    aria-label="Cancelar"
                  >
                    Cancelar
                  </button>
                  <PendingButton
                    className="primary btn-compact btn-save"
                    type="submit"
                    pendingText="Guardando..."
                    title="Guardar plantilla de recordatorio"
                    aria-label="Guardar cambios"
                  >
                    Guardar
                  </PendingButton>
                </div>
              </form>
            );
          })()
        ) : null}
        {activeModal?.type === "reminder" ? (
          <form action={actions.saveReminder} className="notification-form" style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="environment" value={env} />
            <input type="hidden" name="kind" value={activeModal.kind} />
            <input type="hidden" name="paymentType" value={activeModal.paymentType} />
            <input type="hidden" name="templateId" value={activeReminder?.templateId || ""} />
            <input type="hidden" name="templateKind" value="WHATSAPP_TEMPLATE" />
            <input
              type="hidden"
              name="enabled"
              value={(activeReminder?.rule?.enabled ?? true) ? "on" : ""}
            />
            <div className="field row" style={{ justifyContent: "space-between" }}>
              <div className="muted">Tipo: Plantilla (WhatsApp)</div>
            </div>
            <WaTemplateFields
              templates={waTemplates}
              defaultName={activeReminder?.template?.chatwootTemplate?.name || ""}
              defaultLang={activeReminder?.template?.chatwootTemplate?.language || "es"}
              defaultParams={
                (activeReminder?.template?.chatwootTemplate?.processed_params?.body || []).map((p) => p.value).join("|")
              }
              defaultHeaderParams={
                (activeReminder?.template?.chatwootTemplate?.processed_params?.header || []).map((p) => p.value).join("|")
              }
              defaultButtonParams={
                (activeReminder?.template?.chatwootTemplate?.processed_params?.buttons || []).map((p) => p.value).join("|")
              }
              variables={bodyVars}
              buttonVariables={buttonVars}
            />
            <input
              type="hidden"
              name="offsetsSeconds"
              value={reminderOffsets
                .map((o) => secondsFromOffset(o, activeModal.kind === "DUE" ? -1 : 1))
                .join(",")}
            />
            <div className="module-footer">
              <button
                className="ghost btn-compact btn-cancel"
                type="button"
                onClick={() => setActiveModal(null)}
                data-modal-close="true"
                data-loader="off"
                title="Cerrar sin guardar"
                aria-label="Cancelar"
              >
                Cancelar
              </button>
              <PendingButton
                className="primary btn-compact btn-save"
                type="submit"
                pendingText="Guardando..."
                title="Guardar configuración de recordatorio"
                aria-label="Guardar cambios"
              >
                Guardar
              </PendingButton>
            </div>
          </form>
        ) : null}
      </AppModal>
    </div>
  );
}
