"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { HelpTip } from "../ui/HelpTip";
import { useRouter } from "next/navigation";

type Env = "PRODUCTION" | "SANDBOX";
type Trigger = "SUBSCRIPTION_DUE" | "PAYMENT_LINK_CREATED" | "PAYMENT_APPROVED" | "PAYMENT_DECLINED";
type TemplateKind = "TEXT" | "WHATSAPP_TEMPLATE";
type PaymentType = "ANY" | "PLAN" | "SUBSCRIPTION" | "LINK";
type NotificationKind =
  | "PAYMENT_LINK"
  | "PAYMENT_APPROVED_SUBSCRIPTION"
  | "PAYMENT_APPROVED_PLAN"
  | "PAYMENT_APPROVED_LINK"
  | "PAYMENT_DECLINED_SUBSCRIPTION"
  | "PAYMENT_DECLINED_PLAN"
  | "PAYMENT_DECLINED_LINK"
  | "REMINDER_DUE"
  | "REMINDER_MORA";

const VARIABLES = [
  { label: "Nombre completo", value: "{{customer.name}}" },
  { label: "Email", value: "{{customer.email}}" },
  { label: "Teléfono", value: "{{customer.phone}}" },
  { label: "Dirección", value: "{{customer.metadata.address}}" },
  { label: "Plan", value: "{{plan.name}}" },
  { label: "Fecha corte", value: "{{subscription.currentPeriodEndAt}}" },
  { label: "Fecha pago", value: "{{payment.paidAt}}" },
  { label: "Referencia", value: "{{payment.reference}}" },
  { label: "Link pago", value: "{{payment.checkoutUrl}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" }
];

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
  createNotification
}: {
  envDefault?: Env;
  createNotification: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
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

  const [templateKind, setTemplateKind] = useState<TemplateKind>("TEXT");
  const [message, setMessage] = useState("");

  const [waTemplateName, setWaTemplateName] = useState("");
  const [waLanguage] = useState("es");
  const [waParams, setWaParams] = useState<string[]>([]);

  const lastFocusableRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

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

  function canGoNext() {
    if (step === 1) return true;
    if (step === 2) {
      if (!computedOffsetsSeconds.length) return false;
      if (trigger === "SUBSCRIPTION_DUE" && ensurePaymentLink == null) return false;
      return true;
    }
    if (step === 3) {
      if (templateKind === "TEXT") return !!message.trim();
      return !!waTemplateName.trim() && !!waLanguage.trim();
    }
    return false;
  }

  function onCreate() {
    setSubmitError("");
    setSubmitOk("");
    const fd = new FormData();
    fd.set("environment", env);
    fd.set("trigger", trigger);
    fd.set("title", title);
    fd.set("templateKind", templateKind);
    fd.set("message", message);
    fd.set("waTemplateName", waTemplateName);
    fd.set("waLanguage", waLanguage);
    fd.set("ensurePaymentLink", ensurePaymentLink ? "1" : "0");
    fd.set("atTimeUtc", atTimeEnabled ? atTimeUtc : "");
    fd.set("paymentType", paymentType);
    for (const s of computedOffsetsSeconds) fd.append("offsetSeconds", String(s));
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
      setTemplateKind("TEXT");
      setMessage("");
      setWaTemplateName("");
      setWaLanguage("");
      setWaParams([""]);
      setEnsurePaymentLink(null);
      setAtTimeEnabled(false);
      setAtTimeUtc("");
      applyKind(createdKind);
      router.refresh();
    });
  }

  function applyKind(next: NotificationKind) {
    setNotificationKind(next);
    if (next === "PAYMENT_LINK") {
      setTrigger("PAYMENT_LINK_CREATED");
      setPaymentType("ANY");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "PAYMENT_APPROVED_SUBSCRIPTION") {
      setTrigger("PAYMENT_APPROVED");
      setPaymentType("SUBSCRIPTION");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "PAYMENT_APPROVED_PLAN") {
      setTrigger("PAYMENT_APPROVED");
      setPaymentType("PLAN");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "PAYMENT_APPROVED_LINK") {
      setTrigger("PAYMENT_APPROVED");
      setPaymentType("LINK");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "PAYMENT_DECLINED_SUBSCRIPTION") {
      setTrigger("PAYMENT_DECLINED");
      setPaymentType("SUBSCRIPTION");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "PAYMENT_DECLINED_PLAN") {
      setTrigger("PAYMENT_DECLINED");
      setPaymentType("PLAN");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "PAYMENT_DECLINED_LINK") {
      setTrigger("PAYMENT_DECLINED");
      setPaymentType("LINK");
      setOffsets([{ direction: "after", amount: "0", unit: "minutes" }]);
      return;
    }
    if (next === "REMINDER_MORA") {
      setTrigger("SUBSCRIPTION_DUE");
      setPaymentType("ANY");
      setOffsets([{ direction: "after", amount: "1", unit: "days" }]);
      return;
    }
    // REMINDER_DUE (default)
    setTrigger("SUBSCRIPTION_DUE");
    setPaymentType("ANY");
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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
          {submitOk ? <div className="card cardPad">{submitOk}</div> : null}
          {submitError ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
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
                  <strong>Notificaciones (tiempo real)</strong>
                  <div className="field-hint">Se envían cuando ocurre el evento.</div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_LINK" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_LINK")}>
                    <span>Link de pago</span>
                    {lastCreatedKind === "PAYMENT_LINK" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_APPROVED_SUBSCRIPTION" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_APPROVED_SUBSCRIPTION")}>
                    <span>Pago exitoso (suscripción)</span>
                    {lastCreatedKind === "PAYMENT_APPROVED_SUBSCRIPTION" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_APPROVED_PLAN" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_APPROVED_PLAN")}>
                    <span>Pago exitoso (plan)</span>
                    {lastCreatedKind === "PAYMENT_APPROVED_PLAN" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_APPROVED_LINK" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_APPROVED_LINK")}>
                    <span>Pago recibido por link de pago</span>
                    {lastCreatedKind === "PAYMENT_APPROVED_LINK" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_DECLINED_SUBSCRIPTION" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_DECLINED_SUBSCRIPTION")}>
                    <span>Pago fallido (suscripción)</span>
                    {lastCreatedKind === "PAYMENT_DECLINED_SUBSCRIPTION" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_DECLINED_PLAN" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_DECLINED_PLAN")}>
                    <span>Pago fallido (plan)</span>
                    {lastCreatedKind === "PAYMENT_DECLINED_PLAN" ? <span className="module-check">✓ Lista</span> : null}
                  </button>
                  <button type="button" className={`ghost module-choice ${notificationKind === "PAYMENT_DECLINED_LINK" ? "is-active" : ""}`} onClick={() => applyKind("PAYMENT_DECLINED_LINK")}>
                    <span>Pago fallido (link de pago)</span>
                    {lastCreatedKind === "PAYMENT_DECLINED_LINK" ? <span className="module-check">✓ Lista</span> : null}
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
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>Aplica a</span>
                  <HelpTip text="Se configura automáticamente según el tipo de notificación." />
                </label>
                <input className="input" value={paymentType === "ANY" ? "Todos" : paymentType === "PLAN" ? "Pago del plan" : paymentType === "SUBSCRIPTION" ? "Pago suscripción" : "Pago por link de pago"} readOnly />
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="field">
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                    >
                      + Agregar otro recordatorio
                    </button>
                  </div>
                </div>

                {trigger === "SUBSCRIPTION_DUE" ? (
                  <div style={{ marginTop: 10 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" checked={ensurePaymentLink} onChange={(e) => setEnsurePaymentLink(e.target.checked)} />
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        Si falta link de pago, generarlo automáticamente
                        <HelpTip text="Si no existe link, el sistema intenta crearlo antes de enviar el recordatorio." />
                      </span>
                    </label>
                  </div>
                ) : null}

                <div style={{ marginTop: 10 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={atTimeEnabled} onChange={(e) => setAtTimeEnabled(e.target.checked)} />
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
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
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="field">
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>Plantilla / mensaje</span>
                  <HelpTip text="Mensaje normal: escribes el texto.\nTemplate WhatsApp: envías una plantilla aprobada por Meta (vía Central de Comunicaciones Apiflujos)." />
                </label>
                <select className="select" value={templateKind} onChange={(e) => setTemplateKind(e.target.value as TemplateKind)}>
                  <option value="TEXT">Mensaje normal</option>
                  <option value="WHATSAPP_TEMPLATE">Template WhatsApp (Meta) vía Central de Comunicaciones Apiflujos</option>
                </select>
              </div>

              <div className="panel module" style={{ display: "grid", gap: 10 }}>
                <div className="field-hint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>Variables (clic para insertar):</span>
                  <HelpTip text="Estas variables se reemplazan con datos reales al enviar.\nSi algún dato no existe, se deja vacío." />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {VARIABLES.map((v) => (
                    <button key={v.value} type="button" className="ghost" onClick={() => onVarClick(v.value)} style={{ minHeight: 30 }}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel module" style={{ display: "grid", gap: 10 }}>
                <div className="field-hint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>Emojis</span>
                  <HelpTip text="Clic para insertar un emoji en el campo activo." />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {["✅", "❌", "⏰", "💳", "⚠️", "📌", "📅", "🙏"].map((e) => (
                    <button key={e} type="button" className="ghost" onClick={() => onVarClick(e)} style={{ minHeight: 30, minWidth: 42 }}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {templateKind === "TEXT" ? (
                <div className="field">
                  <label>Mensaje</label>
                  <textarea
                    className="input"
                    rows={8}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onFocus={(e) => (lastFocusableRef.current = e.target)}
                    placeholder="Ej: Hola {{customer.name}}, tu pago vence el {{subscription.currentPeriodEndAt}}. Link: {{payment.checkoutUrl}}"
                    style={{ padding: 12 }}
                  />
                </div>
              ) : (
                <>
                  <div className="field">
                    <label>ID de plantilla (Meta)</label>
                    <input
                      className="input"
                      value={waTemplateName}
                      onChange={(e) => setWaTemplateName(e.target.value)}
                      onFocus={(e) => (lastFocusableRef.current = e.target)}
                      placeholder="nombre_template"
                    />
                    <div className="field-hint">El idioma se envía como <code>es</code> (si necesitas otro, lo habilitamos).</div>
                  </div>

                  <div className="field">
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span>Variables de la plantilla (opcional)</span>
                      <HelpTip text="Si tu plantilla tiene variables en el body ({{1}}, {{2}}, ...), agrégalas aquí en orden.\nSi no tiene variables, deja esto vacío." />
                    </label>
                    <div style={{ display: "grid", gap: 8 }}>
                      {waParams.map((v, idx) => (
                        <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" } as any}>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Variable #{idx + 1}</label>
                            <input
                              className="input"
                              value={v}
                              onChange={(e) => setWaParams((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))}
                              onFocus={(e) => (lastFocusableRef.current = e.target)}
                              placeholder="Ej: {{customer.name}}"
                            />
                          </div>
                          <button type="button" className="ghost" onClick={() => setWaParams((prev) => prev.filter((_, i) => i !== idx))}>
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="ghost" onClick={() => setWaParams((prev) => [...prev, ""])} style={{ marginTop: 8 }}>
                      + Agregar variable
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null}

          <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="ghost" type="button" onClick={() => setStep((s) => (s === 1 ? 1 : ((s - 1) as any)))} disabled={step === 1}>
                Atrás
              </button>
              {step < 3 ? (
                <button className="primary" type="button" onClick={() => setStep((s) => (s === 3 ? 3 : ((s + 1) as any)))} disabled={!canGoNext() || isPending}>
                  Siguiente
                </button>
              ) : null}
            </div>

            {step === 3 ? (
              <button className="primary" type="button" onClick={onCreate} disabled={!canGoNext() || isPending}>
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
