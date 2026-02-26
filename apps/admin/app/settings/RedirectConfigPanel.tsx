"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PendingButton } from "../ui/PendingButton";

type CheckoutConfig = {
  planBaseUrl?: string | null;
  subscriptionBaseUrl?: string | null;
  defaultUtmParams?: string | null;
  planWompiTitle?: string | null;
  planWompiDescription?: string | null;
  subscriptionWompiTitle?: string | null;
  subscriptionWompiDescription?: string | null;
  tokenizationSuccessTitle?: string | null;
  tokenizationSuccessMessage?: string | null;
  tokenizationErrorMessage?: string | null;
  tokenizationReturnUrl?: string | null;
};

function normalizeBaseUrl(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/g, "");
}

export function RedirectConfigPanel({
  defaults,
  csrfToken,
  onSave,
  inlineState,
  returnTo
}: {
  defaults: CheckoutConfig;
  csrfToken: string;
  onSave: (formData: FormData) => void;
  inlineState: { action: string; status: string; errorText: string };
  returnTo?: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [publicBaseUrl, setPublicBaseUrl] = useState<string>(() => {
    const existing = String(defaults.planBaseUrl || defaults.subscriptionBaseUrl || "").trim();
    if (!existing) return "";
    return existing.replace(/\/public\/(plan|suscripcion).*/i, "");
  });
  const [planBaseUrl, setPlanBaseUrl] = useState<string>(String(defaults.planBaseUrl || ""));
  const [subscriptionBaseUrl, setSubscriptionBaseUrl] = useState<string>(String(defaults.subscriptionBaseUrl || ""));
  const [tokenReturnUrl, setTokenReturnUrl] = useState<string>(String(defaults.tokenizationReturnUrl || ""));
  const [tokenSuccessTitle, setTokenSuccessTitle] = useState<string>(String(defaults.tokenizationSuccessTitle || "Gracias"));
  const [tokenSuccessMessage, setTokenSuccessMessage] = useState<string>(String(defaults.tokenizationSuccessMessage || "Tu método de pago quedó guardado correctamente."));
  const [tokenErrorMessage, setTokenErrorMessage] = useState<string>(String(defaults.tokenizationErrorMessage || "No pudimos guardar tu método de pago. Intenta nuevamente."));
  const [planWompiTitle, setPlanWompiTitle] = useState<string>(String(defaults.planWompiTitle || ""));
  const [planWompiDescription, setPlanWompiDescription] = useState<string>(String(defaults.planWompiDescription || ""));
  const [subscriptionWompiTitle, setSubscriptionWompiTitle] = useState<string>(String(defaults.subscriptionWompiTitle || ""));
  const [subscriptionWompiDescription, setSubscriptionWompiDescription] = useState<string>(String(defaults.subscriptionWompiDescription || ""));
  const [defaultUtmParams, setDefaultUtmParams] = useState<string>(String(defaults.defaultUtmParams || ""));

  const baseHint = useMemo(() => {
    if (!publicBaseUrl) return "";
    const base = normalizeBaseUrl(publicBaseUrl);
    return `${base}/public/plan/{token} · ${base}/public/suscripcion/{token}`;
  }, [publicBaseUrl]);

  const [pendingAutoSave, setPendingAutoSave] = useState(false);

  function generateUrlsAndSave() {
    const base = normalizeBaseUrl(publicBaseUrl);
    if (!base) return;
    setPlanBaseUrl(`${base}/public/plan`);
    setSubscriptionBaseUrl(`${base}/public/suscripcion`);
    if (!tokenReturnUrl) setTokenReturnUrl(base);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
    setPendingAutoSave(true);
  }

  useEffect(() => {
    if (!pendingAutoSave) return;
    setPendingAutoSave(false);
    formRef.current?.requestSubmit();
  }, [pendingAutoSave, planBaseUrl, subscriptionBaseUrl, tokenReturnUrl, defaultUtmParams]);

  return (
    <form ref={formRef} action={onSave} className="panel module" style={{ display: "grid", gap: 14 }}>
      <input type="hidden" name="csrf" value={csrfToken} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <input type="hidden" name="planBaseUrl" value={planBaseUrl} />
      <input type="hidden" name="subscriptionBaseUrl" value={subscriptionBaseUrl} />
      <input type="hidden" name="tokenizationReturnUrl" value={tokenReturnUrl} />
      <input type="hidden" name="tokenizationSuccessTitle" value={tokenSuccessTitle} />
      <input type="hidden" name="tokenizationSuccessMessage" value={tokenSuccessMessage} />
      <input type="hidden" name="tokenizationErrorMessage" value={tokenErrorMessage} />
      <input type="hidden" name="planWompiTitle" value={planWompiTitle} />
      <input type="hidden" name="planWompiDescription" value={planWompiDescription} />
      <input type="hidden" name="subscriptionWompiTitle" value={subscriptionWompiTitle} />
      <input type="hidden" name="subscriptionWompiDescription" value={subscriptionWompiDescription} />
      <input type="hidden" name="defaultUtmParams" value={defaultUtmParams} />

      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Redirecciones y Mensajes</strong>
          <div className="field-hint">URLs públicas + mensajes que aparecen en Wompi.</div>
        </div>
        <button className="ghost" type="button" onClick={generateUrlsAndSave}>
          Generar y guardar
        </button>
      </div>

      <div className="field">
        <label>URL pública base</label>
        <input
          className="input"
          value={publicBaseUrl}
          onChange={(e) => setPublicBaseUrl(e.target.value)}
          onBlur={(e) => {
            const next = normalizeBaseUrl(e.target.value);
            if (next && !/^https?:\/\//i.test(next)) {
              setPublicBaseUrl(`https://${next}`);
            }
          }}
          placeholder="https://mdv.sus.apiflujos.com"
        />
        {baseHint ? <div className="field-hint">Se generarán: {baseHint}</div> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>Base URL Plan</label>
          <input className="input" value={planBaseUrl} onChange={(e) => setPlanBaseUrl(e.target.value)} placeholder="https://.../public/plan" />
        </div>
        <div className="field">
          <label>Base URL Suscripción</label>
          <input className="input" value={subscriptionBaseUrl} onChange={(e) => setSubscriptionBaseUrl(e.target.value)} placeholder="https://.../public/suscripcion" />
        </div>
      </div>

      <div className="field">
        <label>UTM por defecto</label>
        <input
          className="input"
          value={defaultUtmParams}
          onChange={(e) => setDefaultUtmParams(e.target.value)}
          placeholder="utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv"
        />
        <div className="field-hint">Se aplica si la plantilla no tiene UTM.</div>
      </div>

      <div className="field">
        <label>URL retorno tokenización</label>
        <input className="input" value={tokenReturnUrl} onChange={(e) => setTokenReturnUrl(e.target.value)} placeholder="https://tu-sitio.com" />
        <div className="field-hint">Este link se usa en el botón “Volver”.</div>
      </div>

      <div className="panel module" style={{ margin: 0 }}>
        <div className="panel-header">
          <strong>Mensajes de tokenización</strong>
        </div>
        <div className="field">
          <label>Título éxito</label>
          <input className="input" value={tokenSuccessTitle} onChange={(e) => setTokenSuccessTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Mensaje éxito</label>
          <textarea className="input" rows={2} value={tokenSuccessMessage} onChange={(e) => setTokenSuccessMessage(e.target.value)} />
        </div>
        <div className="field">
          <label>Mensaje error</label>
          <textarea className="input" rows={2} value={tokenErrorMessage} onChange={(e) => setTokenErrorMessage(e.target.value)} />
        </div>
      </div>

      <div className="panel module" style={{ margin: 0 }}>
        <div className="panel-header">
          <strong>Mensajes Wompi</strong>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label>Título plan</label>
            <input className="input" value={planWompiTitle} onChange={(e) => setPlanWompiTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Descripción plan</label>
            <input className="input" value={planWompiDescription} onChange={(e) => setPlanWompiDescription(e.target.value)} />
          </div>
          <div className="field">
            <label>Título suscripción</label>
            <input className="input" value={subscriptionWompiTitle} onChange={(e) => setSubscriptionWompiTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Descripción suscripción</label>
            <input className="input" value={subscriptionWompiDescription} onChange={(e) => setSubscriptionWompiDescription(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          {inlineState.action === "checkout_config" && inlineState.status === "ok" ? <div className="field-hint">Guardado.</div> : null}
          {inlineState.action === "checkout_config" && inlineState.status === "fail" ? (
            <div className="field-hint" style={{ color: "var(--danger)" }}>
              Error: {inlineState.errorText || "unknown_error"}
            </div>
          ) : null}
        </div>
        <PendingButton className="primary" type="submit" pendingText="Guardando...">
          Guardar
        </PendingButton>
      </div>
    </form>
  );
}
