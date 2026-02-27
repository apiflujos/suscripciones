"use client";

import { useEffect, useRef, useState } from "react";
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
  const isFixedBase = true;
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
  const hasConfig = Boolean(String(defaults.planBaseUrl || defaults.subscriptionBaseUrl || defaults.tokenizationReturnUrl || "").trim());
  const [editMode, setEditMode] = useState(false);

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
    if (inlineState.action === "checkout_config" && inlineState.status === "ok") {
      setEditMode(false);
    }
  }, [inlineState.action, inlineState.status]);

  useEffect(() => {
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base) return;
    setPlanBaseUrl(`${base}/public/plan`);
    setSubscriptionBaseUrl(`${base}/public/suscripcion`);
    setTokenReturnUrl(`${base}/public/return`);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
  }, [publicBaseUrl, appPublicBaseUrl]);

  useEffect(() => {
    if (hasConfig || autoSavedRef.current) return;
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base || !planBaseUrl || !subscriptionBaseUrl || !tokenReturnUrl) return;
    autoSavedRef.current = true;
    formRef.current?.requestSubmit();
  }, [hasConfig, publicBaseUrl, appPublicBaseUrl, planBaseUrl, subscriptionBaseUrl, tokenReturnUrl]);

  return (
    <div className="panel module" style={{ display: "grid", gap: 14 }}>
      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Redirecciones y Mensajes</strong>
          <div className="field-hint">URLs públicas + mensajes que aparecen en Wompi.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {urlsReady && tokenMessagesReady ? <span className="pill pill-ok">Listo</span> : null}
          {!editMode ? (
            <button className="ghost" type="button" onClick={() => setEditMode(true)}>
              Editar
            </button>
          ) : null}
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

      {editMode ? (
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

          <div className="field">
            <label>URL pública base</label>
            <input
              className="input"
              value={publicBaseUrl}
              readOnly
            />
            <div className="field-hint">
              Definido por ENV. No se permite editar.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Base URL Plan</label>
              <input className="input" value={planBaseUrl} readOnly />
            </div>
            <div className="field">
              <label>Base URL Suscripción</label>
              <input className="input" value={subscriptionBaseUrl} readOnly />
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
            <input className="input" value={tokenReturnUrl} readOnly />
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

          <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              {inlineState.action === "checkout_config" && inlineState.status === "ok" ? <div className="field-hint">Guardado.</div> : null}
              {inlineState.action === "checkout_config" && inlineState.status === "fail" ? (
                <div className="field-hint" style={{ color: "var(--danger)" }}>
                  Error: {inlineState.errorText || "unknown_error"}
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="ghost" onClick={() => setEditMode(false)}>
                Cancelar
              </button>
              <PendingButton className="primary" type="submit" pendingText="Guardando...">
                Guardar
              </PendingButton>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
