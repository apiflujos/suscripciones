"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";
import { FormActions } from "../ui/PageShell";

export type CheckoutConfig = {
  planBaseUrl?: string | null;
  subscriptionBaseUrl?: string | null;
  cartBaseUrl?: string | null;
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

export function RedirectConfigForm({
  defaults,
  appPublicBaseUrl,
  csrfToken,
  returnTo,
  cancelHref,
  onSave
}: {
  defaults: CheckoutConfig;
  appPublicBaseUrl?: string;
  csrfToken: string;
  returnTo: string;
  cancelHref: string;
  onSave: (formData: FormData) => void;
}) {
  const [publicBaseUrl, setPublicBaseUrl] = useState<string>(() => {
    const existing = String(defaults.planBaseUrl || defaults.subscriptionBaseUrl || defaults.cartBaseUrl || "").trim();
    if (existing) return existing.replace(/\/public\/(plan|suscripcion|cart).*/i, "");
    const base = String(appPublicBaseUrl || "").trim();
    return base || "";
  });
  const [planBaseUrl, setPlanBaseUrl] = useState<string>(String(defaults.planBaseUrl || ""));
  const [subscriptionBaseUrl, setSubscriptionBaseUrl] = useState<string>(String(defaults.subscriptionBaseUrl || ""));
  const [cartBaseUrl, setCartBaseUrl] = useState<string>(String(defaults.cartBaseUrl || ""));
  const [tokenReturnUrl, setTokenReturnUrl] = useState<string>(String(defaults.tokenizationReturnUrl || ""));
  const [tokenSuccessTitle, setTokenSuccessTitle] = useState<string>(String(defaults.tokenizationSuccessTitle || "Gracias"));
  const [tokenSuccessMessage, setTokenSuccessMessage] = useState<string>(String(defaults.tokenizationSuccessMessage || "Tu método de pago quedó guardado correctamente."));
  const [tokenErrorMessage, setTokenErrorMessage] = useState<string>(String(defaults.tokenizationErrorMessage || "No pudimos guardar tu método de pago. Intenta nuevamente."));
  const [defaultUtmParams, setDefaultUtmParams] = useState<string>(String(defaults.defaultUtmParams || ""));
  const [lastDerivedBase, setLastDerivedBase] = useState<string>(() => {
    const existing = String(defaults.planBaseUrl || defaults.subscriptionBaseUrl || defaults.cartBaseUrl || "").trim();
    return existing ? existing.replace(/\/public\/(plan|suscripcion|cart).*/i, "") : "";
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

  const urlsReady = Boolean(planBaseUrl && subscriptionBaseUrl && cartBaseUrl && tokenReturnUrl);
  const tokenMessagesReady = Boolean(tokenSuccessTitle && tokenSuccessMessage && tokenErrorMessage);

  useEffect(() => {
    const base = normalizeBaseUrl(publicBaseUrl || appPublicBaseUrl || "");
    if (!base) return;
    const prevBase = normalizeBaseUrl(lastDerivedBase);
    const shouldSyncPlan = !planBaseUrl || (prevBase && planBaseUrl === `${prevBase}/public/plan`);
    const shouldSyncSub = !subscriptionBaseUrl || (prevBase && subscriptionBaseUrl === `${prevBase}/public/suscripcion`);
    const shouldSyncCart = !cartBaseUrl || (prevBase && cartBaseUrl === `${prevBase}/public/cart`);
    const shouldSyncReturn = !tokenReturnUrl || (prevBase && tokenReturnUrl === `${prevBase}/public/return`);
    if (shouldSyncPlan) setPlanBaseUrl(`${base}/public/plan`);
    if (shouldSyncSub) setSubscriptionBaseUrl(`${base}/public/suscripcion`);
    if (shouldSyncCart) setCartBaseUrl(`${base}/public/cart`);
    if (shouldSyncReturn) setTokenReturnUrl(`${base}/public/return`);
    if (!defaultUtmParams) setDefaultUtmParams("utm_source=apiflujos&utm_medium=checkout&utm_campaign=mdv");
    if (base !== prevBase) setLastDerivedBase(base);
  }, [publicBaseUrl, appPublicBaseUrl, planBaseUrl, subscriptionBaseUrl, cartBaseUrl, tokenReturnUrl, defaultUtmParams, lastDerivedBase]);

  const publicBaseNormalized = useMemo(() => normalizeBaseUrl(publicBaseUrl), [publicBaseUrl]);
  const planInvalid = planBaseUrl ? !isValidUrl(planBaseUrl) : false;
  const subInvalid = subscriptionBaseUrl ? !isValidUrl(subscriptionBaseUrl) : false;
  const cartInvalid = cartBaseUrl ? !isValidUrl(cartBaseUrl) : false;
  const returnInvalid = tokenReturnUrl ? !isValidUrl(tokenReturnUrl) : false;

  return (
        <form action={onSave} className="page-shell-body">
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <section className="page-shell-section"><div className="page-shell-section-body">
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
                      Catálogo: {publicBaseNormalized}/public/cart
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Retorno tokenización: {publicBaseNormalized}/public/return
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="field">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label htmlFor="rd-publicBase">URL pública base</label>
                  <HelpTip text="Dominio público donde viven los checkouts. Al cambiarlo, se sugieren las URLs derivadas." />
                </div>
                <input id="rd-publicBase" className="input" value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} placeholder="https://tudominio.com" />
                <div className="field-hint">Dominio público donde viven los checkouts.</div>
              </div>
              <div className="field">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label htmlFor="rd-planBaseUrl">Base URL Plan</label>
                  <HelpTip text="Se usa para generar los links de pago únicos." />
                </div>
                <input id="rd-planBaseUrl" className="input" name="planBaseUrl" value={planBaseUrl} onChange={(e) => setPlanBaseUrl(e.target.value)} />
                {planInvalid ? <div className="field-hint" style={{ color: "var(--danger)" }}>URL inválida. Debe iniciar con http(s).</div> : null}
              </div>
              <div className="field">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label htmlFor="rd-subscriptionBaseUrl">Base URL Suscripción</label>
                  <HelpTip text="Se usa para tokenización y suscripciones automáticas." />
                </div>
                <input id="rd-subscriptionBaseUrl" className="input" name="subscriptionBaseUrl" value={subscriptionBaseUrl} onChange={(e) => setSubscriptionBaseUrl(e.target.value)} />
                {subInvalid ? <div className="field-hint" style={{ color: "var(--danger)" }}>URL inválida. Debe iniciar con http(s).</div> : null}
              </div>
              <div className="field">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label htmlFor="rd-cartBaseUrl">Base URL Catálogo</label>
                  <HelpTip text="Se usa para los catálogos públicos y la selección de productos." />
                </div>
                <input id="rd-cartBaseUrl" className="input" name="cartBaseUrl" value={cartBaseUrl} onChange={(e) => setCartBaseUrl(e.target.value)} />
                {cartInvalid ? <div className="field-hint" style={{ color: "var(--danger)" }}>URL inválida. Debe iniciar con http(s).</div> : null}
              </div>
              <div className="field">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label htmlFor="rd-defaultUtmParams">UTM por defecto</label>
                  <HelpTip text="Se añade a los links de pago para trazabilidad (source/medium/campaign)." />
                </div>
                <input id="rd-defaultUtmParams" className="input" name="defaultUtmParams" value={defaultUtmParams} onChange={(e) => setDefaultUtmParams(e.target.value)} />
              </div>
              <div className="field">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label htmlFor="rd-tokenizationReturnUrl">URL retorno público</label>
                  <HelpTip text="Destino del botón 'Volver' tras tokenizar y fallback de retorno de checkout." />
                </div>
                <input id="rd-tokenizationReturnUrl" className="input" name="tokenizationReturnUrl" value={tokenReturnUrl} onChange={(e) => setTokenReturnUrl(e.target.value)} />
                {returnInvalid ? <div className="field-hint" style={{ color: "var(--danger)" }}>URL inválida. Debe iniciar con http(s).</div> : null}
              </div>
              <div className="field">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label htmlFor="rd-tokenizationSuccessTitle">Título éxito</label>
                  <HelpTip text="Se muestra en la pantalla de tokenización exitosa." />
                </div>
                <input id="rd-tokenizationSuccessTitle" className="input" name="tokenizationSuccessTitle" value={tokenSuccessTitle} onChange={(e) => setTokenSuccessTitle(e.target.value)} />
              </div>
              <div className="field">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label htmlFor="rd-tokenizationSuccessMessage">Mensaje éxito</label>
                  <HelpTip text="Mensaje principal al guardar el método de pago." />
                </div>
                <textarea id="rd-tokenizationSuccessMessage" className="input" rows={3} name="tokenizationSuccessMessage" value={tokenSuccessMessage} onChange={(e) => setTokenSuccessMessage(e.target.value)} />
              </div>
              <div className="field">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label htmlFor="rd-tokenizationErrorMessage">Mensaje error</label>
                  <HelpTip text="Mensaje cuando falla la tokenización." />
                </div>
                <textarea id="rd-tokenizationErrorMessage" className="input" rows={3} name="tokenizationErrorMessage" value={tokenErrorMessage} onChange={(e) => setTokenErrorMessage(e.target.value)} />
              </div>
              </div></section>
              <FormActions cancelHref={cancelHref}>
                <PendingButton
                  className="primary btn-compact btn-save"
                  type="submit"
                  pendingText="Guardando..."
                  title="Guardar configuración de redirección"
                >
                  Guardar
                </PendingButton>
              </FormActions>
        </form>
  );
}
