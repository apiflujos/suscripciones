"use client";

import { useEffect, useState } from "react";
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

function autoResizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function RedirectConfigPanel({
  defaults,
  appPublicBaseUrl,
  csrfToken,
  returnTo,
  onSave
}: {
  defaults: CheckoutConfig;
  appPublicBaseUrl?: string;
  csrfToken: string;
  returnTo: string;
  onSave: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
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
          <button className="ghost" type="button" data-loader="off" onClick={() => setOpen(true)}>
            Editar
          </button>
        </div>
      </div>

      <div className="saved-conn-meta" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">URLs públicas</span>
          <span className="saved-conn-meta-value">{planBaseUrl && subscriptionBaseUrl ? "Configuradas" : "—"}</span>
        </div>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">UTM por defecto</span>
          <span className="saved-conn-meta-value">{defaultUtmParams ? "Configurado" : "—"}</span>
        </div>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">Tokenización</span>
          <span className="saved-conn-meta-value">
            {tokenReturnUrl && tokenSuccessTitle && tokenSuccessMessage && tokenErrorMessage ? "Configurada" : "—"}
          </span>
        </div>
      </div>

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 900 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Editar redirecciones y mensajes</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <form action={onSave} className="panel module" style={{ display: "grid", gap: 12 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="field">
                <label>URL pública base</label>
                <input className="input" value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} placeholder="https://tudominio.com" />
                <div className="field-hint">Dominio público donde viven los checkouts.</div>
              </div>
              <div className="field">
                <label>Base URL Plan</label>
                <input className="input" name="planBaseUrl" value={planBaseUrl} onChange={(e) => setPlanBaseUrl(e.target.value)} />
              </div>
              <div className="field">
                <label>Base URL Suscripción</label>
                <input className="input" name="subscriptionBaseUrl" value={subscriptionBaseUrl} onChange={(e) => setSubscriptionBaseUrl(e.target.value)} />
              </div>
              <div className="field">
                <label>UTM por defecto</label>
                <input className="input" name="defaultUtmParams" value={defaultUtmParams} onChange={(e) => setDefaultUtmParams(e.target.value)} />
              </div>
              <div className="field">
                <label>URL retorno débito automático</label>
                <input className="input" name="tokenizationReturnUrl" value={tokenReturnUrl} onChange={(e) => setTokenReturnUrl(e.target.value)} />
              </div>
              <div className="field">
                <label>Título éxito</label>
                <input className="input" name="tokenizationSuccessTitle" value={tokenSuccessTitle} onChange={(e) => setTokenSuccessTitle(e.target.value)} />
              </div>
              <div className="field">
                <label>Mensaje éxito</label>
                <textarea className="input" rows={3} name="tokenizationSuccessMessage" value={tokenSuccessMessage} onChange={(e) => setTokenSuccessMessage(e.target.value)} />
              </div>
              <div className="field">
                <label>Mensaje error</label>
                <textarea className="input" rows={3} name="tokenizationErrorMessage" value={tokenErrorMessage} onChange={(e) => setTokenErrorMessage(e.target.value)} />
              </div>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" data-loader="off" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <PendingButton className="primary btn-save" type="submit" pendingText="Guardando...">
                  Guardar
                </PendingButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
