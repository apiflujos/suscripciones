import Link from "next/link";
import type { CheckoutConfig } from "./RedirectConfigForm";

/**
 * Resumen de "Redirecciones y Mensajes" en la pestaña Checkout público. Editar abre la
 * página /settings/redirects (antes era un modal).
 */
export function RedirectConfigPanel({
  defaults,
  inlineState
}: {
  defaults: CheckoutConfig;
  inlineState?: { action: string; status: string; errorText: string };
}) {
  const hasUrls = Boolean(defaults.planBaseUrl && defaults.subscriptionBaseUrl && defaults.cartBaseUrl);
  const hasUtm = Boolean(defaults.defaultUtmParams);
  const tokenReady = Boolean(
    defaults.tokenizationReturnUrl &&
      defaults.tokenizationSuccessTitle &&
      defaults.tokenizationSuccessMessage &&
      defaults.tokenizationErrorMessage
  );
  const msg = inlineState && inlineState.action === "checkout_config" ? inlineState : null;

  return (
    <div className="panel module" style={{ display: "grid", gap: 14 }}>
      <div className="panelHeaderRow" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong>Redirecciones y Mensajes</strong>
          <div className="field-hint">URLs públicas + mensajes que aparecen en Wompi.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {hasUrls && tokenReady ? <span className="pill pill-ok">Listo</span> : null}
          <Link
            className="ghost btn-compact"
            href={`/settings/redirects?returnTo=${encodeURIComponent("/settings?tab=checkout-publico")}`}
            data-loader="off"
          >
            Editar
          </Link>
        </div>
      </div>

      {msg?.status === "ok" ? <div className="field-hint is-success" role="status">Guardado.</div> : null}
      {msg?.status === "fail" ? (
        <div className="field-hint" role="alert" style={{ color: "var(--danger)" }}>
          Error guardando: {msg.errorText || "unknown_error"}
        </div>
      ) : null}

      <div className="saved-conn-meta" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">URLs públicas</span>
          <span className="saved-conn-meta-value">{hasUrls ? "Configuradas" : "—"}</span>
        </div>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">UTM por defecto</span>
          <span className="saved-conn-meta-value">{hasUtm ? "Configurado" : "—"}</span>
        </div>
        <div className="saved-conn-meta-item">
          <span className="saved-conn-meta-label">Tokenización</span>
          <span className="saved-conn-meta-value">{tokenReady ? "Configurada" : "—"}</span>
        </div>
      </div>
    </div>
  );
}
