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
  appPublicBaseUrl,
  csrfToken,
  onSave,
  inlineState,
  returnTo
}: {
  defaults: CheckoutConfig;
  appPublicBaseUrl?: string;
  csrfToken: string;
  onSave: (formData: FormData) => void;
  inlineState: { action: string; status: string; errorText: string };
  returnTo?: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const autoSavedRef = useRef(false);
  const [publicBaseUrl, setPublicBaseUrl] = useState<string>(() => {
    const existing = String(defaults.planBaseUrl || defaults.subscriptionBaseUrl || "").trim();
    if (existing) return existing.replace(/\/public\/(plan|suscripcion).*/i, "");
    const base = String(appPublicBaseUrl || "").trim();
    return base || "";
  });
  const [planBaseUrl, setPlanBaseUrl] = useState<string>(String(defaults.planBaseUrl || ""));
  const [subscriptionBaseUrl, setSubscriptionBaseUrl] = useState<string>(String(defaults.subscriptionBaseUrl || ""));
  const [tokenReturnUrl, setTokenReturnUrl] = useState<string>(String(defaults.tokenizationReturnUrl || ""));
  const [tokenSuccessTitle, setTokenSuccessTitle] = useState<string>(String(defaults.tokenizationSuccessTitle || "Gracias"));
  const [tokenSuccessMessage, setTokenSuccessMessage] = useState<string>(String(defaults.tokenizationSuccessMessage || "Tu método de pago quedó guardado correctamente."));
  const [tokenErrorMessage, setTokenErrorMessage] = useState<string>(String(defaults.tokenizationErrorMessage || "No pudimos guardar tu método de pago. Intenta nuevamente."));
  const [planWompiTitle] = useState<string>(String(defaults.planWompiTitle || ""));
  const [planWompiDescription] = useState<string>(String(defaults.planWompiDescription || ""));
  const [subscriptionWompiTitle] = useState<string>(String(defaults.subscriptionWompiTitle || ""));
  const [subscriptionWompiDescription] = useState<string>(String(defaults.subscriptionWompiDescription || ""));
  const [defaultUtmParams, setDefaultUtmParams] = useState<string>(String(defaults.defaultUtmParams || ""));
  const hasConfig = Boolean(String(defaults.planBaseUrl || defaults.subscriptionBaseUrl || defaults.tokenizationReturnUrl || "").trim());
  const [isEditing, setIsEditing] = useState(!hasConfig);

  useEffect(() => {
    if (!publicBaseUrl && appPublicBaseUrl) {
      setPublicBaseUrl(appPublicBaseUrl);
    }
  }, [appPublicBaseUrl, publicBaseUrl]);

  const baseHint = useMemo(() => {
    if (!publicBaseUrl) return "";
    const base = normalizeBaseUrl(publicBaseUrl);
    return `${base}/public/plan/{token} · ${base}/public/suscripcion/{token}`;
  }, [publicBaseUrl]);

  const urlsReady = Boolean(planBaseUrl && subscriptionBaseUrl && tokenReturnUrl);
  const tokenMessagesReady = Boolean(tokenSuccessTitle && tokenSuccessMessage && tokenErrorMessage);

  useEffect(() => {
    if (inlineState.action === "checkout_config" && inlineState.status === "ok") {
      setIsEditing(false);
    }
  }, [inlineState.action, inlineState.status]);

  useEffect(() => {
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base) return;
    if (!planBaseUrl) setPlanBaseUrl(`${base}/public/plan`);
    if (!subscriptionBaseUrl) setSubscriptionBaseUrl(`${base}/public/suscripcion`);
    if (!tokenReturnUrl) setTokenReturnUrl(`${base}/public/return`);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
  }, [publicBaseUrl, appPublicBaseUrl]);

  useEffect(() => {
    if (hasConfig || autoSavedRef.current) return;
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base || !planBaseUrl || !subscriptionBaseUrl || !tokenReturnUrl) return;
    autoSavedRef.current = true;
    formRef.current?.requestSubmit();
  }, [hasConfig, publicBaseUrl, appPublicBaseUrl, planBaseUrl, subscriptionBaseUrl, tokenReturnUrl]);

  function generateUrls() {
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base) return;
    if (!isEditing) setIsEditing(true);
    setPlanBaseUrl(`${base}/public/plan`);
    setSubscriptionBaseUrl(`${base}/public/suscripcion`);
    if (!tokenReturnUrl) setTokenReturnUrl(`${base}/public/return`);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
  }

  function generatePlanUrl() {
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base) return;
    if (!isEditing) setIsEditing(true);
    setPlanBaseUrl(`${base}/public/plan`);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
  }

  function generateSubscriptionUrl() {
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base) return;
    if (!isEditing) setIsEditing(true);
    setSubscriptionBaseUrl(`${base}/public/suscripcion`);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
  }

  function generateReturnUrl() {
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base) return;
    if (!isEditing) setIsEditing(true);
    setTokenReturnUrl(`${base}/public/return`);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
  }

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
      <input type="hidden" name="defaultUtmParams" value={defaultUtmParams} />

      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Redirecciones y Mensajes</strong>
          <div className="field-hint">URLs públicas + mensajes que aparecen en Wompi.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {urlsReady ? <span className="pill pill-ok">Listo</span> : null}
          {isEditing ? (
            <button className="ghost" type="button" onClick={generateUrls}>
              Generar
            </button>
          ) : null}
        </div>
      </div>

      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>URL pública base</span>
          {publicBaseUrl ? <span className="pill pill-ok pill-sm">Listo</span> : null}
        </label>
        <input
          className="input"
          value={publicBaseUrl}
          onChange={(e) => setPublicBaseUrl(e.target.value)}
          placeholder="https://mdv.sus.apiflujos.com"
          disabled
        />
        {baseHint ? <div className="field-hint">Se generarán: {baseHint}</div> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Base URL Plan</span>
            {planBaseUrl ? <span className="pill pill-ok pill-sm">Listo</span> : null}
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" value={planBaseUrl} onChange={(e) => setPlanBaseUrl(e.target.value)} placeholder="https://.../public/plan" disabled={!isEditing} />
            <button className="ghost" type="button" onClick={generatePlanUrl}>
              Generar
            </button>
          </div>
        </div>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Base URL Suscripción</span>
            {subscriptionBaseUrl ? <span className="pill pill-ok pill-sm">Listo</span> : null}
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" value={subscriptionBaseUrl} onChange={(e) => setSubscriptionBaseUrl(e.target.value)} placeholder="https://.../public/suscripcion" disabled={!isEditing} />
            <button className="ghost" type="button" onClick={generateSubscriptionUrl}>
              Generar
            </button>
          </div>
        </div>
      </div>

      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>UTM por defecto</span>
          {defaultUtmParams ? <span className="pill pill-ok pill-sm">Listo</span> : null}
        </label>
        <input
          className="input"
          value={defaultUtmParams}
          onChange={(e) => setDefaultUtmParams(e.target.value)}
          placeholder="utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv"
          disabled={!isEditing}
        />
        <div className="field-hint">Se aplica si la plantilla no tiene UTM.</div>
      </div>

      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>URL retorno tokenización</span>
          {tokenReturnUrl ? <span className="pill pill-ok pill-sm">Listo</span> : null}
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="input" value={tokenReturnUrl} onChange={(e) => setTokenReturnUrl(e.target.value)} placeholder="https://tu-sitio.com" disabled={!isEditing} />
          <button className="ghost" type="button" onClick={generateReturnUrl}>
            Generar
          </button>
        </div>
        <div className="field-hint">Este link se usa en el botón “Volver”.</div>
      </div>

      <div className="panel module" style={{ margin: 0 }}>
        <div className="panel-header" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <strong>Mensajes de tokenización</strong>
          {tokenMessagesReady ? <span className="pill pill-ok">Listo</span> : null}
        </div>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Título éxito</span>
            {tokenSuccessTitle ? <span className="pill pill-ok pill-sm">Listo</span> : null}
          </label>
          <input className="input" value={tokenSuccessTitle} onChange={(e) => setTokenSuccessTitle(e.target.value)} disabled={!isEditing} />
        </div>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Mensaje éxito</span>
            {tokenSuccessMessage ? <span className="pill pill-ok pill-sm">Listo</span> : null}
          </label>
          <textarea className="input" rows={2} value={tokenSuccessMessage} onChange={(e) => setTokenSuccessMessage(e.target.value)} disabled={!isEditing} />
        </div>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Mensaje error</span>
            {tokenErrorMessage ? <span className="pill pill-ok pill-sm">Listo</span> : null}
          </label>
          <textarea className="input" rows={2} value={tokenErrorMessage} onChange={(e) => setTokenErrorMessage(e.target.value)} disabled={!isEditing} />
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
        {isEditing ? (
          <PendingButton className="primary" type="submit" pendingText="Guardando...">
            Guardar
          </PendingButton>
        ) : (
          <button className="ghost" type="button" onClick={() => setIsEditing(true)}>
            Editar
          </button>
        )}
      </div>
    </form>
  );
}
