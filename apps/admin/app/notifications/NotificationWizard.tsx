"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { HelpTip } from "../ui/HelpTip";
import { useRouter } from "next/navigation";

type Env = "PRODUCTION" | "SANDBOX";
type Trigger = "SUBSCRIPTION_DUE" | "PAYMENT_LINK_CREATED" | "PAYMENT_APPROVED" | "PAYMENT_DECLINED";
type PaymentType = "ANY" | "PLAN" | "SUBSCRIPTION" | "LINK";
type NotificationKind =
  | "PAYMENT_LINK"
  | "PAYMENT_APPROVED"
  | "PAYMENT_DECLINED"
  | "REMINDER_DUE"
  | "REMINDER_MORA";

const VARIABLES = [
  { label: "Ciclo actual", value: "{{subscription.currentCycle}}" },
  { label: "Correo electrónico", value: "{{customer.email}}" },
  { label: "Dirección", value: "{{customer.metadata.address}}" },
  { label: "Checkout público (Token)", value: "{{checkoutPublicToken.ID}}" },
  { label: "Checkout público (Nombre)", value: "{{checkoutPublicName.ID}}" },
  { label: "Checkout público (Automático · Token)", value: "{{checkoutPublicToken.AUTO}}" },
  { label: "Checkout público (Automático · Nombre)", value: "{{checkoutPublicName.AUTO}}" },
  { label: "Estado de la suscripción", value: "{{subscription.status}}" },
  { label: "Estado del pago", value: "{{payment.status}}" },
  { label: "Fecha de corte", value: "{{subscription.currentPeriodEndAt}}" },
  { label: "Fecha de creación del pago", value: "{{payment.createdAt}}" },
  { label: "Fecha de fallo del pago", value: "{{payment.failedAt}}" },
  { label: "Fecha de inicio del ciclo", value: "{{subscription.currentPeriodStartAt}}" },
  { label: "Fecha de pago", value: "{{payment.paidAt}}" },
  { label: "Frecuencia (cantidad)", value: "{{plan.intervalCount}}" },
  { label: "Frecuencia (unidad)", value: "{{plan.intervalUnit}}" },
  { label: "Moneda del pago", value: "{{payment.currency}}" },
  { label: "Moneda del producto", value: "{{plan.currency}}" },
  { label: "Monto del pago (pesos)", value: "{{payment.amountInPesos}}" },
  { label: "Nombre del producto", value: "{{plan.name}}" },
  { label: "Precio del producto (pesos)", value: "{{plan.priceInPesos}}" },
  { label: "Referencia", value: "{{payment.reference}}" },
  { label: "Teléfono", value: "{{customer.phone}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

type ChatwootTemplate = {
  id?: string | number;
  name: string;
  language?: string;
  category?: string;
  status?: string;
  components?: any[];
  content?: any;
};

function unitToSeconds(unit: string, amount: number) {
  if (!Number.isFinite(amount)) return 0;
  if (unit === "seconds") return amount;
  if (unit === "minutes") return amount * 60;
  if (unit === "hours") return amount * 60 * 60;
  if (unit === "days") return amount * 24 * 60 * 60;
  return amount * 60;
}

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

export function NotificationWizard({
  envDefault = "PRODUCTION",
  createNotification,
  csrfToken
}: {
  envDefault?: Env;
  createNotification: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  csrfToken: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string>("");
  const [submitOk, setSubmitOk] = useState<string>("");
  const [lastCreatedKind, setLastCreatedKind] = useState<NotificationKind | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [env, setEnv] = useState<Env>(envDefault);

  const [trigger, setTrigger] = useState<Trigger>("SUBSCRIPTION_DUE");
  const [paymentType, setPaymentType] = useState<PaymentType>("ANY");
  const [notificationKind, setNotificationKind] = useState<NotificationKind>("REMINDER_DUE");

  const [offsets, setOffsets] = useState<Array<{ direction: "before" | "after"; amount: string; unit: "seconds" | "minutes" | "hours" | "days" }>>([
    { direction: "before", amount: "1", unit: "days" }
  ]);

  const [ensurePaymentLink, setEnsurePaymentLink] = useState(true);
  const [title, setTitle] = useState("");
  const [atTimeEnabled, setAtTimeEnabled] = useState(false);
  const [atTimeUtc, setAtTimeUtc] = useState("09:00");

  const [waTemplateName, setWaTemplateName] = useState("");
  const [waLanguage, setWaLanguage] = useState("es");
  const [waParams, setWaParams] = useState<string[]>([]);
  const [waTemplates, setWaTemplates] = useState<ChatwootTemplate[]>([]);
  const [waTemplatesLoading, setWaTemplatesLoading] = useState(false);
  const [waTemplatesError, setWaTemplatesError] = useState("");

  const lastFocusableRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let mounted = true;
    setWaTemplatesLoading(true);
    setWaTemplatesError("");
    fetch("/admin/comms?op=whatsapp_templates", { cache: "no-store" })
      .then((res) => res.json().catch(() => ({})))
      .then((json) => {
        if (!mounted) return;
        if (!json?.ok || !Array.isArray(json?.templates)) {
          setWaTemplatesError(String(json?.error || "sync_failed"));
          setWaTemplates([]);
          return;
        }
        setWaTemplates(json.templates);
      })
      .catch((err) => {
        if (!mounted) return;
        setWaTemplatesError(String(err?.message || "sync_failed"));
        setWaTemplates([]);
      })
      .finally(() => {
        if (!mounted) return;
        setWaTemplatesLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const computedOffsetsSeconds = useMemo(() => {
    return offsets
      .map((o) => {
        const amount = Number(o.amount);
        const seconds = unitToSeconds(o.unit, amount);
        const signed = o.direction === "before" ? -seconds : seconds;
        return Number.isFinite(signed) ? Math.trunc(signed) : 0;
      })
      .filter((s) => Number.isFinite(s));
  }, [offsets]);

  function onVarClick(v: string) {
    const el = (document.activeElement as any) as HTMLInputElement | HTMLTextAreaElement | null;
    const target = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") ? el : lastFocusableRef.current;
    if (!target) return;
    insertAtCursor(target, v);
  }

  const isRealtimeTrigger = trigger === "PAYMENT_LINK_CREATED" || trigger === "PAYMENT_APPROVED" || trigger === "PAYMENT_DECLINED";

  function canGoNext() {
    if (step === 1) return true;
    if (step === 2) {
      if (isRealtimeTrigger) return true;
      if (!computedOffsetsSeconds.length) return false;
      if (trigger === "SUBSCRIPTION_DUE" && ensurePaymentLink == null) return false;
      return true;
    }
    if (step === 3) {
      return !!waTemplateName.trim() && !!waLanguage.trim();
    }
    return false;
  }

  function onCreate() {
    setSubmitError("");
    setSubmitOk("");
    const fd = new FormData();
    fd.set("csrf", csrfToken);
    fd.set("environment", env);
    fd.set("trigger", trigger);
    fd.set("title", title);
    fd.set("templateKind", "WHATSAPP_TEMPLATE");
    fd.set("waTemplateName", waTemplateName);
    fd.set("waLanguage", waLanguage);
    fd.set("ensurePaymentLink", ensurePaymentLink ? "1" : "0");
    fd.set("atTimeUtc", atTimeEnabled ? atTimeUtc : "");
    fd.set("paymentType", paymentType);
    if (!isRealtimeTrigger) {
      for (const s of computedOffsetsSeconds) fd.append("offsetSeconds", String(s));
    }
    const bodyParams = waParams.slice(0, bodyParamCount);
    const headerParams = waParams.slice(bodyParamCount, bodyParamCount + headerParamCount);
    const buttonParams = waParams.slice(bodyParamCount + headerParamCount, bodyParamCount + headerParamCount + buttonParamCount);
    for (const p of bodyParams) fd.append("waBodyParam", p);
    for (const p of headerParams) fd.append("waHeaderParam", p);
    for (const p of buttonParams) fd.append("waButtonParam", p);
    for (const p of waParams) fd.append("waParam", p);

    const createdKind = notificationKind;
    startTransition(async () => {
      const res = await createNotification(fd);
      if (!res.ok) {
        setSubmitError(res.error || "unknown_error");
        return;
      }
      setSubmitOk("Notificación creada.");
      setLastCreatedKind(createdKind);
      setStep(1);
      setTitle("");
      setWaTemplateName("");
      setWaParams([""]);
      setEnsurePaymentLink(true);
      setAtTimeEnabled(false);
      setAtTimeUtc("");
      applyKind(createdKind);
      router.refresh();
    });
  }

  const selectedTemplate = waTemplateName
    ? waTemplates.find((t) => t.name === waTemplateName && (!t.language || t.language === waLanguage)) ||
      waTemplates.find((t) => t.name === waTemplateName) ||
      null
    : null;
  const selectedTemplateBody = useMemo(() => {
    const comps = (selectedTemplate as any)?.components || [];
    const body = comps.find((c: any) => String(c?.type || "").toUpperCase() === "BODY") as any;
    return String(body?.text || "");
  }, [selectedTemplate]);
  const selectedTemplatePreview = useMemo(() => {
    if (!selectedTemplateBody) return "";
    return selectedTemplateBody.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
      const idx = Math.max(1, Number(n)) - 1;
      const val = waParams[idx];
      return val ? String(val) : `{{${n}}}`;
    });
  }, [selectedTemplateBody, waParams]);
  const headerParamCount = useMemo(() => {
    const comps = selectedTemplate?.components;
    if (!Array.isArray(comps)) return 0;
    const header = comps.find((c: any) => String(c?.type || "").toUpperCase() === "HEADER");
    if (!header) return 0;
    const fmt = String(header?.format || header?.format_type || "").toUpperCase();
    if (fmt && fmt !== "TEXT") return 0;
    return Array.isArray(header?.example?.header_text) ? header.example.header_text.length : 0;
  }, [selectedTemplate]);
  const bodyParamCount = useMemo(() => {
    const comps = selectedTemplate?.components;
    if (!Array.isArray(comps)) return 0;
    const body = comps.find((c: any) => String(c?.type || "").toUpperCase() === "BODY");
    if (!body) return 0;
    return Array.isArray(body?.example?.body_text) ? (body.example.body_text[0]?.length || 0) : 0;
  }, [selectedTemplate]);
  const buttonParamCount = useMemo(() => {
    const comps = selectedTemplate?.components;
    if (!Array.isArray(comps)) return 0;
    const buttons = comps.find((c: any) => String(c?.type || "").toUpperCase() === "BUTTONS");
    if (!buttons || !Array.isArray(buttons?.buttons)) return 0;
    return buttons.buttons.filter((b: any) => String(b?.type || "").toUpperCase() === "URL").length;
  }, [selectedTemplate]);

  function applyKind(next: NotificationKind) {
    setNotificationKind(next);
    if (next === "PAYMENT_LINK") {
      setTrigger("PAYMENT_LINK_CREATED");
      setPaymentType("ANY");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "PAYMENT_APPROVED") {
      setTrigger("PAYMENT_APPROVED");
      setPaymentType("ANY");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "PAYMENT_DECLINED") {
      setTrigger("PAYMENT_DECLINED");
      setPaymentType("LINK");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "REMINDER_MORA") {
      setTrigger("SUBSCRIPTION_DUE");
      setPaymentType("LINK");
      setOffsets([{ direction: "after", amount: "1", unit: "days" }]);
      return;
    }
    // REMINDER_DUE (default)
    setTrigger("SUBSCRIPTION_DUE");
    setPaymentType("LINK");
    setOffsets([{ direction: "before", amount: "1", unit: "days" }]);
  }

  return (
    <section className="settings-group">
      <div className="settings-group-header">
        <div className="panelHeaderRow">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3>Crear notificación / recordatorio</h3>
            <span className="pill">Paso {step}/3</span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div className="field" style={{ margin: 0, minWidth: 220 }}>
              <label>Entorno</label>
              <select className="select" value={env} onChange={(e) => setEnv((e.target.value as Env) || "PRODUCTION")}>
                <option value="PRODUCTION">Producción</option>
                <option value="SANDBOX">Sandbox</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-group-body">
        <div className="panel module" style={{ display: "grid", gap: 12 }}>
          <div aria-live="polite" role="status">
            {submitOk ? <div className="card cardPad">{submitOk}</div> : null}
          </div>
          {submitError ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }} role="alert">
              Error: {submitError}
            </div>
          ) : null}

          {step === 1 ? (
            <>
              <div className="field">
                <label>Nombre (opcional)</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Recordatorio 1 día antes" />
              </div>

              <div className="panel module" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <strong>Notificaciones WhatsApp (tiempo real)</strong>
                  <div className="field-hint">Se envían cuando ocurre el evento.</div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_LINK" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_LINK")}>
                    <span>Link de pago</span>
                    {lastCreatedKind === "PAYMENT_LINK" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_APPROVED" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_APPROVED")}>
                    <span>Pago exitoso</span>
                    {lastCreatedKind === "PAYMENT_APPROVED" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_DECLINED" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_DECLINED")}>
                    <span>Pago fallido</span>
                    {lastCreatedKind === "PAYMENT_DECLINED" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                </div>
              </div>

              <div className="panel module" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <strong>Recordatorios (programados)</strong>
                  <div className="field-hint">Se calculan con la fecha de corte.</div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <button type="button" className={`ghost module-choice ${notificationKind === "REMINDER_DUE" ? "is-active" : ""}`} onClick={() => applyKind("REMINDER_DUE")}>
                    <span>Recordatorio de fecha de pago</span>
                    {lastCreatedKind === "REMINDER_DUE" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                  <button type="button" className={`ghost module-choice ${notificationKind === "REMINDER_MORA" ? "is-active" : ""}`} onClick={() => applyKind("REMINDER_MORA")}>
                    <span>Recordatorio pago en mora</span>
                    {lastCreatedKind === "REMINDER_MORA" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                </div>
              </div>

              <div className="field">
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span>Aplica a</span>
                  <HelpTip text="Se configura automáticamente según el tipo de notificación." />
                </label>
                <input className="input" value={paymentType === "ANY" ? "Todos" : paymentType === "PLAN" ? "Pago por link de pago" : paymentType === "SUBSCRIPTION" ? "Pago suscripción" : "Pago por link de pago"} readOnly />
              </div>
              {notificationKind === "PAYMENT_DECLINED" || notificationKind === "REMINDER_DUE" || notificationKind === "REMINDER_MORA" ? (
                <div className="panel module" style={{ display: "grid", gap: 6 }}>
                  <strong>Tipo de cobro</strong>
                  <div style={{ display: "grid", gap: 6 }}>
                    <button
                      type="button"
                      className={`ghost module-choice ${paymentType === "LINK" ? "is-active" : ""}`}
                      onClick={() => setPaymentType("LINK")}
                    >
                      <span>Link de pago</span>
                    </button>
                    <button
                      type="button"
                      className={`ghost module-choice ${paymentType === "SUBSCRIPTION" ? "is-active" : ""}`}
                      onClick={() => setPaymentType("SUBSCRIPTION")}
                    >
                      <span>Débito automático</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              {isRealtimeTrigger ? (
                <div className="card cardPad">Se envía inmediatamente cuando ocurre el evento.</div>
              ) : (
                <div className="field">
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span>¿Cuándo se envía?</span>
                    <HelpTip text="Puedes agregar varios tiempos (antes/después) en segundos, minutos, horas o días." />
                  </label>
                  <div style={{ display: "grid", gap: 10 }}>
                    {offsets.map((o, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "140px 1fr 180px auto", gap: 10, alignItems: "end" } as any}>
                        <div className="field" style={{ margin: 0 }}>
                          <label>Antes/Después</label>
                          <select
                            className="select"
                            value={o.direction}
                            onChange={(e) => {
                              const direction = e.target.value as any;
                              setOffsets((prev) => prev.map((x, i) => (i === idx ? { ...x, direction } : x)));
                            }}
                          >
                            <option value="before">Antes</option>
                            <option value="after">Después</option>
                          </select>
                        </div>
                        <div className="field" style={{ margin: 0 }}>
                          <label>Cantidad</label>
                          <input
                            className="input"
                            value={o.amount}
                            onChange={(e) => setOffsets((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
                          />
                        </div>
                        <div className="field" style={{ margin: 0 }}>
                          <label>Unidad</label>
                          <select
                            className="select"
                            value={o.unit}
                            onChange={(e) => setOffsets((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value as any } : x)))}
                          >
                            <option value="seconds">Segundos</option>
                            <option value="minutes">Minutos</option>
                            <option value="hours">Horas</option>
                            <option value="days">Días</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setOffsets((prev) => prev.filter((_, i) => i !== idx))}
                          disabled={offsets.length <= 1}
                          data-loader="off"
                          title="Quitar esta regla de tiempo"
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                    <div>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setOffsets((prev) => [...prev, { direction: "after", amount: "1", unit: "hours" }])}
                        data-loader="off"
                        title="Agregar otra regla de recordatorio"
                      >
                        + Agregar otro recordatorio
                      </button>
                    </div>
                  </div>

                  {trigger === "SUBSCRIPTION_DUE" ? (
                    <div style={{ marginTop: 10 }}>
                      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" checked={ensurePaymentLink} onChange={(e) => setEnsurePaymentLink(e.target.checked)} />
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          Si falta link de pago, generarlo automáticamente
                          <HelpTip text="Si no existe link, el sistema intenta crearlo antes de enviar el recordatorio." />
                        </span>
                      </label>
                    </div>
                  ) : null}

                  <div style={{ marginTop: 10 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={atTimeEnabled} onChange={(e) => setAtTimeEnabled(e.target.checked)} />
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        Enviar a hora exacta (UTC)
                        <HelpTip text="Si activas esto, el envío se hace a la hora exacta (UTC) en la fecha calculada.\nEj: 1 día antes a las 09:00 UTC." />
                      </span>
                    </label>
                    {atTimeEnabled ? (
                      <div style={{ marginTop: 8, maxWidth: 220 }}>
                        <input className="input" type="time" value={atTimeUtc} onChange={(e) => setAtTimeUtc(e.target.value)} />
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="panel module" style={{ display: "grid", gap: 10 }}>
                <div className="field-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span>Variables (clic para insertar):</span>
                  <HelpTip text="Estas variables se reemplazan con datos reales al enviar.\nSi algún dato no existe, se deja vacío." />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {VARIABLES.map((v) => (
                    <button key={v.value} type="button" className="ghost" onClick={() => onVarClick(v.value)} style={{ minHeight: 30 }} data-loader="off">
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span>Plantillas disponibles</span>
                  <HelpTip text="Se cargan desde Chatwoot. Selecciona una plantilla para autocompletar el nombre y el idioma." />
                </label>
                <select
                  className="select"
                  defaultValue=""
                  onChange={(e) => {
                    const [tplName, tplLang] = String(e.target.value || "").split("::");
                    if (tplName) setWaTemplateName(tplName);
                    if (tplLang) setWaLanguage(tplLang);
                  }}
                  disabled={waTemplatesLoading}
                >
                  <option value="">{waTemplatesLoading ? "Cargando..." : "Selecciona una plantilla"}</option>
                  {waTemplates.map((t) => (
                    <option key={`${t.name}:${t.language || "es"}`} value={`${t.name}::${t.language || "es"}`}>
                      {t.name} · {t.language || "es"}
                    </option>
                  ))}
                </select>
                {waTemplatesError ? <div className="field-hint" style={{ color: "var(--danger)" }}>Error: {waTemplatesError}</div> : null}
              </div>
              <div className="field">
                <label>ID de plantilla (Meta)</label>
                <input
                  className="input"
                  value={waTemplateName}
                  onChange={(e) => setWaTemplateName(e.target.value)}
                  onFocus={(e) => (lastFocusableRef.current = e.target)}
                  placeholder="nombre_template"
                  readOnly={Boolean(selectedTemplate)}
                />
              </div>
              <div className="field">
                <label>Mensaje de plantilla</label>
                <textarea className="input" rows={3} readOnly value={selectedTemplateBody} />
              </div>
              <div className="field">
                <label>Vista previa</label>
                <textarea className="input" rows={3} readOnly value={selectedTemplatePreview} />
              </div>
              <input type="hidden" name="waLanguage" value={waLanguage} />

              <div className="field">
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span>Variables de la plantilla</span>
                </label>
                <div style={{ display: "grid", gap: 6 }}>
                  {Array.from({ length: Math.max(bodyParamCount, 0) }).map((_, idx) => (
                    <div key={`body-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                      <label>Body #{idx + 1}</label>
                      <input
                        className="input"
                        value={waParams[idx] || ""}
                        onChange={(e) => setWaParams((prev) => {
                          const next = prev.slice();
                          next[idx] = e.target.value;
                          return next;
                        })}
                        onFocus={(e) => (lastFocusableRef.current = e.target)}
                        placeholder="Ej: {{customer.name}}"
                      />
                    </div>
                  ))}
                  {Array.from({ length: Math.max(headerParamCount, 0) }).map((_, idx) => {
                    const base = bodyParamCount + idx;
                    return (
                      <div key={`header-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                        <label>Header #{idx + 1}</label>
                        <input
                          className="input"
                          value={waParams[base] || ""}
                          onChange={(e) => setWaParams((prev) => {
                            const next = prev.slice();
                            next[base] = e.target.value;
                            return next;
                          })}
                          onFocus={(e) => (lastFocusableRef.current = e.target)}
                          placeholder="Ej: {{subscription.currentPeriodEndAt}}"
                        />
                      </div>
                    );
                  })}
                  {Array.from({ length: Math.max(buttonParamCount, 0) }).map((_, idx) => {
                    const base = bodyParamCount + headerParamCount + idx;
                    return (
                      <div key={`button-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                        <label>Botón URL #{idx + 1}</label>
                        <input
                          className="input"
                          value={waParams[base] || ""}
                          onChange={(e) => setWaParams((prev) => {
                            const next = prev.slice();
                            next[base] = e.target.value;
                            return next;
                          })}
                          onFocus={(e) => (lastFocusableRef.current = e.target)}
                          placeholder="Ej: {{payment.checkoutUrl}}"
                        />
                      </div>
                    );
                  })}
                  {!bodyParamCount && !headerParamCount && !buttonParamCount ? (
                    <div className="field-hint">Esta plantilla no requiere variables.</div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="ghost btn-back" type="button" onClick={() => setStep((s) => (s === 1 ? 1 : ((s - 1) as any)))} disabled={step === 1}>
                Atrás
              </button>
              {step < 3 ? (
                <button className="primary btn-next" type="button" onClick={() => setStep((s) => (s === 3 ? 3 : ((s + 1) as any)))} disabled={!canGoNext() || isPending}>
                  Siguiente
                </button>
              ) : null}
            </div>

            {step === 3 ? (
              <button className="primary btn-create" type="button" onClick={onCreate} disabled={!canGoNext() || isPending}>
                {isPending ? "Creando..." : "Crear"}
              </button>
            ) : (
              <div style={{ opacity: 0.6 }}>Completa los pasos para crear.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
