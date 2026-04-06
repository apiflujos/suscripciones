"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";
import { AppModal } from "../ui/AppModal";

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

function isValidUrl(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return false;
  try {
    // eslint-disable-next-line no-new
    new URL(raw);
    return true;
  } catch {
    return false;
  }
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
  const [lastDerivedBase, setLastDerivedBase] = useState<string>(() => {
    const existing = String(defaults.planBaseUrl || defaults.subscriptionBaseUrl || "").trim();
    return existing ? existing.replace(/\/public\/(plan|suscripcion).*/i, "") : "";
  });

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
    const prevBase = normalizeBaseUrl(lastDerivedBase);
    const shouldSyncPlan = !planBaseUrl || (prevBase && planBaseUrl === `${prevBase}/public/plan`);
    const shouldSyncSub = !subscriptionBaseUrl || (prevBase && subscriptionBaseUrl === `${prevBase}/public/suscripcion`);
    const shouldSyncReturn = !tokenReturnUrl || (prevBase && tokenReturnUrl === `${prevBase}/public/return`);
    if (shouldSyncPlan) setPlanBaseUrl(`${base}/public/plan`);
    if (shouldSyncSub) setSubscriptionBaseUrl(`${base}/public/suscripcion`);
    if (shouldSyncReturn) setTokenReturnUrl(`${base}/public/return`);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
    if (base !== prevBase) setLastDerivedBase(base);
  }, [publicBaseUrl, appPublicBaseUrl, planBaseUrl, subscriptionBaseUrl, tokenReturnUrl, defaultUtmParams, lastDerivedBase]);

  const publicBaseNormalized = useMemo(() => normalizeBaseUrl(publicBaseUrl), [publicBaseUrl]);
  const planInvalid = planBaseUrl ? !isValidUrl(planBaseUrl) : false;
  const subInvalid = subscriptionBaseUrl ? !isValidUrl(subscriptionBaseUrl) : false;
  const returnInvalid = tokenReturnUrl ? !isValidUrl(tokenReturnUrl) : false;

  return (
    <div className="panel module" style={{ display: "grid", gap: 14 }}>
      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Redirecciones y Mensajes</strong>
          <div className="field-hint">URLs públicas + mensajes que aparecen en Wompi.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {urlsReady && tokenMessagesReady ? <span className="pill pill-ok">Listo</span> : null}
          <button className="ghost btn-compact" type="button" data-loader="off" onClick={() => setOpen(true)}>
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

      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        title="Editar redirecciones y mensajes"
        maxWidth={900}
      >
        <form action={onSave} className="panel module" style={{ display: "grid", gap: 12 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {publicBaseNormalized ? (
                <div className="card cardPad" style={{ margin: 0, background: "var(--panel-soft)" }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="field-hint">URLs sugeridas desde la base</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Plan: {publicBaseNormalized}/public/plan
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Suscripción: {publicBaseNormalized}/public/suscripcion
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Retorno tokenización: {publicBaseNormalized}/public/return
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  URL pública base
                  <HelpTip text="Dominio público donde viven los checkouts. Al cambiarlo, se sugieren las URLs derivadas." />
                </label>
                <input className="input" value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} placeholder="https://tudominio.com" />
                <div className="field-hint">Dominio público donde viven los checkouts.</div>
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Base URL Plan
                  <HelpTip text="Se usa para generar los links de pago únicos." />
                </label>
                <input className="input" name="planBaseUrl" value={planBaseUrl} onChange={(e) => setPlanBaseUrl(e.target.value)} />
                {planInvalid ? <div className="field-hint" style={{ color: "var(--danger)" }}>URL inválida. Debe iniciar con http(s).</div> : null}
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Base URL Suscripción
                  <HelpTip text="Se usa para tokenización y suscripciones automáticas." />
                </label>
                <input className="input" name="subscriptionBaseUrl" value={subscriptionBaseUrl} onChange={(e) => setSubscriptionBaseUrl(e.target.value)} />
                {subInvalid ? <div className="field-hint" style={{ color: "var(--danger)" }}>URL inválida. Debe iniciar con http(s).</div> : null}
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  UTM por defecto
                  <HelpTip text="Se añade a los links de pago para trazabilidad (source/medium/campaign)." />
                </label>
                <input className="input" name="defaultUtmParams" value={defaultUtmParams} onChange={(e) => setDefaultUtmParams(e.target.value)} />
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  URL retorno débito automático
                  <HelpTip text="Destino del botón 'Volver' después de tokenizar." />
                </label>
                <input className="input" name="tokenizationReturnUrl" value={tokenReturnUrl} onChange={(e) => setTokenReturnUrl(e.target.value)} />
                {returnInvalid ? <div className="field-hint" style={{ color: "var(--danger)" }}>URL inválida. Debe iniciar con http(s).</div> : null}
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Título éxito
                  <HelpTip text="Se muestra en la pantalla de tokenización exitosa." />
                </label>
                <input className="input" name="tokenizationSuccessTitle" value={tokenSuccessTitle} onChange={(e) => setTokenSuccessTitle(e.target.value)} />
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Mensaje éxito
                  <HelpTip text="Mensaje principal al guardar el método de pago." />
                </label>
                <textarea className="input" rows={3} name="tokenizationSuccessMessage" value={tokenSuccessMessage} onChange={(e) => setTokenSuccessMessage(e.target.value)} />
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Mensaje error
                  <HelpTip text="Mensaje cuando falla la tokenización." />
                </label>
                <textarea className="input" rows={3} name="tokenizationErrorMessage" value={tokenErrorMessage} onChange={(e) => setTokenErrorMessage(e.target.value)} />
              </div>
              <div className="module-footer">
                <button 
                  className="ghost btn-compact btn-cancel" 
                  type="button" 
                  data-loader="off" 
                  onClick={() => setOpen(false)}
                  title="Cerrar sin guardar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton 
                  className="primary btn-compact btn-save" 
                  type="submit" 
                  pendingText="Guardando..."
                  title="Guardar configuración de redirección"
                  aria-label="Guardar cambios"
                >
                  Guardar
                </PendingButton>
              </div>
        </form>
      </AppModal>
    </div>
  );
}
