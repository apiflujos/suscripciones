"use client";

import { useEffect, useState } from "react";

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
  appPublicBaseUrl
}: {
  defaults: CheckoutConfig;
  appPublicBaseUrl?: string;
}) {
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
  const [defaultUtmParams, setDefaultUtmParams] = useState<string>(String(defaults.defaultUtmParams || ""));

  useEffect(() => {
    const fixed = String(appPublicBaseUrl || "").trim();
    if (fixed) {
      setPublicBaseUrl(fixed);
      return;
    }
    if (publicBaseUrl) return;
    if (typeof window !== "undefined" && window.location?.origin) {
      setPublicBaseUrl(window.location.origin);
    }
  }, [appPublicBaseUrl, publicBaseUrl]);

  const urlsReady = Boolean(planBaseUrl && subscriptionBaseUrl && tokenReturnUrl);
  const tokenMessagesReady = Boolean(tokenSuccessTitle && tokenSuccessMessage && tokenErrorMessage);

  useEffect(() => {
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base) return;
    setPlanBaseUrl(`${base}/public/plan`);
    setSubscriptionBaseUrl(`${base}/public/suscripcion`);
    setTokenReturnUrl(`${base}/public/return`);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
  }, [publicBaseUrl, appPublicBaseUrl]);

  return (
    <div className="panel module" style={{ display: "grid", gap: 14 }}>
      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Redirecciones y Mensajes</strong>
          <div className="field-hint">URLs públicas + mensajes que aparecen en Wompi.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {urlsReady && tokenMessagesReady ? <span className="pill pill-ok">Listo</span> : null}
        </div>
      </div>

      <div className="saved-conn-meta" style={{ gridTemplateColumns: "1fr", gap: 8 }}>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">URL pública base</span>
          <span className="saved-conn-meta-value">{publicBaseUrl || "—"}</span>
        </div>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">Base URL Plan</span>
          <span className="saved-conn-meta-value">{planBaseUrl || "—"}</span>
        </div>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">Base URL Suscripción</span>
          <span className="saved-conn-meta-value">{subscriptionBaseUrl || "—"}</span>
        </div>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">UTM por defecto</span>
          <span className="saved-conn-meta-value">{defaultUtmParams || "—"}</span>
        </div>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">URL retorno tokenización</span>
          <span className="saved-conn-meta-value">{tokenReturnUrl || "—"}</span>
        </div>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">Tokenización (éxito / error)</span>
          <span className="saved-conn-meta-value">
            {tokenSuccessTitle && tokenSuccessMessage && tokenErrorMessage ? "Configurado" : "—"}
          </span>
        </div>
      </div>

    </div>
  );
}
