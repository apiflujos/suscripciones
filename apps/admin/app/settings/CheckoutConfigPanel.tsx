"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";

type CheckoutConfig = {
  planBaseUrl?: string | null;
  subscriptionBaseUrl?: string | null;
  tokenExpiryHours?: number | null;
  timeZone?: string | null;
  logoUrl?: string | null;
  supportEmail?: string | null;
  supportUrl?: string | null;
  planTitle?: string | null;
  planDescription?: string | null;
  subscriptionTitle?: string | null;
  subscriptionDescription?: string | null;
  planWompiTitle?: string | null;
  planWompiDescription?: string | null;
  subscriptionWompiTitle?: string | null;
  subscriptionWompiDescription?: string | null;
  tokenizationSuccessTitle?: string | null;
  tokenizationSuccessMessage?: string | null;
  tokenizationErrorMessage?: string | null;
  tokenizationReturnUrl?: string | null;
};

export function CheckoutConfigPanel({
  defaults,
  csrfToken,
  onSave,
  inlineState,
  mode = "PLAN",
  showPreview = true,
  showFullscreen = true,
  returnTo
}: {
  defaults: CheckoutConfig;
  csrfToken: string;
  onSave: (formData: FormData) => void;
  inlineState: { action: string; status: string; errorText: string };
  mode?: "PLAN" | "SUBSCRIPTION";
  showPreview?: boolean;
  showFullscreen?: boolean;
  returnTo?: string;
}) {
  function autoResizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }
  const [logoData, setLogoData] = useState<string>(defaults.logoUrl || "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tokenExpiryHours, setTokenExpiryHours] = useState<string>(String(defaults.tokenExpiryHours || 24));
  const [timeZone, setTimeZone] = useState<string>(String(defaults.timeZone || "America/Bogota"));
  const [checkoutTitle, setCheckoutTitle] = useState<string>(String(defaults.planTitle || defaults.subscriptionTitle || "Checkout"));
  const [checkoutDescription, setCheckoutDescription] = useState<string>(String(defaults.planDescription || defaults.subscriptionDescription || ""));
  const [supportEmail, setSupportEmail] = useState<string>(String(defaults.supportEmail || ""));
  const [supportUrl, setSupportUrl] = useState<string>(String(defaults.supportUrl || ""));
  const [tokenSuccessTitle, setTokenSuccessTitle] = useState<string>(String(defaults.tokenizationSuccessTitle || "Gracias"));
  const [tokenSuccessMessage, setTokenSuccessMessage] = useState<string>(
    String(defaults.tokenizationSuccessMessage || "Tu método de pago quedó guardado correctamente.")
  );
  const [tokenErrorMessage, setTokenErrorMessage] = useState<string>(
    String(defaults.tokenizationErrorMessage || "No pudimos guardar tu método de pago. Intenta nuevamente.")
  );
  const [tokenReturnUrl, setTokenReturnUrl] = useState<string>(String(defaults.tokenizationReturnUrl || ""));

  useEffect(() => {
    if (defaults.logoUrl) setLogoData(String(defaults.logoUrl));
  }, [defaults.logoUrl]);

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) setLogoData(result);
    };
    reader.readAsDataURL(file);
  }

  const previewPlan = useMemo(() => ({ title: checkoutTitle, description: checkoutDescription, cta: "Pagar" }), [checkoutTitle, checkoutDescription]);
  const previewSub = useMemo(
    () => ({ title: checkoutTitle, description: checkoutDescription, cta: "Guardar método" }),
    [checkoutTitle, checkoutDescription]
  );

  return (
    <form action={onSave} className="panel module" style={{ display: "grid", gap: 16 }}>
      <input type="hidden" name="csrf" value={csrfToken} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <input type="hidden" name="logoUrl" value={logoData} />
      <input type="hidden" name="planTitle" value={checkoutTitle} />
      <input type="hidden" name="planDescription" value={checkoutDescription} />
      <input type="hidden" name="subscriptionTitle" value={checkoutTitle} />
      <input type="hidden" name="subscriptionDescription" value={checkoutDescription} />
      <input type="hidden" name="planWompiTitle" value={checkoutTitle} />
      <input type="hidden" name="planWompiDescription" value={checkoutDescription} />
      <input type="hidden" name="subscriptionWompiTitle" value={checkoutTitle} />
      <input type="hidden" name="subscriptionWompiDescription" value={checkoutDescription} />
      <input type="hidden" name="tokenizationSuccessTitle" value={tokenSuccessTitle} />
      <input type="hidden" name="tokenizationSuccessMessage" value={tokenSuccessMessage} />
      <input type="hidden" name="tokenizationErrorMessage" value={tokenErrorMessage} />
      <input type="hidden" name="tokenizationReturnUrl" value={tokenReturnUrl} />
      <input type="hidden" name="supportEmail" value={supportEmail} />
      <input type="hidden" name="supportUrl" value={supportUrl} />
      <input type="hidden" name="timeZone" value={timeZone} />

      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Configuración de checkout</strong>
          <div className="field-hint">Expiración y textos públicos.</div>
        </div>
        {showFullscreen ? (
          <button className="ghost btn-compact" type="button" data-loader="off" onClick={() => setPreviewOpen(true)}>
            Ver fullscreen
          </button>
        ) : null}
      </div>

      <div className="field">
        <label>Logo</label>
        <div className="file-row">
          <input type="file" accept="image/*" onChange={onLogoFile} />
          {logoData ? <img src={logoData} alt="Logo" className="logo-preview" /> : null}
        </div>
      </div>


      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>Expiración link (horas)</label>
          <input className="input" name="tokenExpiryHours" value={tokenExpiryHours} onChange={(e) => setTokenExpiryHours(e.target.value)} />
        </div>
        <div className="field">
          <label>Zona horaria</label>
          <input className="input" list="timezones" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="America/Bogota" />
          <datalist id="timezones">
            <option value="America/Bogota" />
            <option value="America/Mexico_City" />
            <option value="America/Lima" />
            <option value="America/Santiago" />
            <option value="America/Argentina/Buenos_Aires" />
            <option value="UTC" />
          </datalist>
        </div>
      </div>

      <div className="panel module" style={{ margin: 0 }}>
        <div className="panel-header">
          <strong>Checkout público</strong>
        </div>
        <div className="field">
          <label>Título</label>
          <input className="input" value={checkoutTitle} onChange={(e) => setCheckoutTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Descripción</label>
          <textarea
            className="input"
            rows={1}
            value={checkoutDescription}
            onChange={(e) => setCheckoutDescription(e.target.value)}
            onInput={(e) => autoResizeTextarea(e.currentTarget)}
          />
        </div>
        <div className="field">
          <label>Email de soporte</label>
          <input className="input" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="soporte@tu-dominio.com" />
        </div>
        <div className="field">
          <label>URL de soporte</label>
          <input className="input" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} placeholder="https://wa.me/57..." />
        </div>
      </div>

      <div className="panel module" style={{ margin: 0 }}>
        <div className="panel-header">
          <strong>Tokenización pública</strong>
        </div>
        <div className="field">
          <label>Título éxito</label>
          <input className="input" value={tokenSuccessTitle} onChange={(e) => setTokenSuccessTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Mensaje éxito</label>
          <textarea
            className="input"
            rows={1}
            value={tokenSuccessMessage}
            onChange={(e) => setTokenSuccessMessage(e.target.value)}
            onInput={(e) => autoResizeTextarea(e.currentTarget)}
          />
        </div>
        <div className="field">
          <label>Mensaje error</label>
          <textarea
            className="input"
            rows={1}
            value={tokenErrorMessage}
            onChange={(e) => setTokenErrorMessage(e.target.value)}
            onInput={(e) => autoResizeTextarea(e.currentTarget)}
          />
        </div>
        <div className="field">
          <label>URL de retorno (botón)</label>
          <input className="input" value={tokenReturnUrl} onChange={(e) => setTokenReturnUrl(e.target.value)} placeholder="https://tusitio.com" />
        </div>
      </div>

      <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          {inlineState.action === "checkout_config" && inlineState.status === "ok" ? <div className="field-hint">Configuración guardada.</div> : null}
          {inlineState.action === "checkout_config" && inlineState.status === "fail" ? (
            <div className="field-hint" style={{ color: "var(--danger)" }}>
              Error: {inlineState.errorText || "unknown_error"}
            </div>
          ) : null}
        </div>
        <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
          Guardar
        </PendingButton>
      </div>

      {showPreview ? (
        <div className="panel module" style={{ margin: 0 }}>
          <div className="panel-header">
            <strong>Preview</strong>
          </div>
          <div className="preview-grid">
            {[
              { label: `${mode === "PLAN" ? "Plan" : "Suscripción"} · Desktop`, data: mode === "PLAN" ? previewPlan : previewSub },
              { label: `${mode === "PLAN" ? "Plan" : "Suscripción"} · Mobile`, data: mode === "PLAN" ? previewPlan : previewSub }
            ].map((item) => (
              <div key={item.label} className={`preview-card ${item.label.includes("Mobile") ? "preview-mobile" : ""}`}>
                <div className="preview-device">{item.label}</div>
                <div className={`preview-layout ${item.label.includes("Mobile") ? "preview-layout-mobile" : ""}`}>
                  <div className="preview-intro">
                    {logoData ? <img src={logoData} alt="Logo" className="logo-preview" /> : null}
                    <div className="canvas-title">{item.data.title}</div>
                    {item.data.description ? <div className="canvas-muted">{item.data.description}</div> : null}
                  </div>
                  <div className="preview-form">
                    <div className="canvas-form-preview">
                      <div className="canvas-input"><span>Nombre completo</span></div>
                      <div className="canvas-input"><span>Teléfono</span></div>
                    </div>
                    <button type="button" className="canvas-cta">{item.data.cta}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showPreview && previewOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,10,10,0.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            padding: 0
          }}
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="panel module"
            style={{ width: "100vw", height: "100vh", maxHeight: "100vh", borderRadius: 0, overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Preview fullscreen</strong>
              <button className="ghost modal-close" type="button" onClick={() => setPreviewOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <div className="preview-grid">
              {[
                { label: "Plan · Desktop", data: previewPlan },
                { label: "Plan · Mobile", data: previewPlan },
                { label: "Suscripción · Desktop", data: previewSub },
                { label: "Suscripción · Mobile", data: previewSub }
              ].map((item) => (
                <div key={item.label} className={`preview-card ${item.label.includes("Mobile") ? "preview-mobile" : ""}`}>
                  <div className="preview-device">{item.label}</div>
                  <div className={`preview-layout ${item.label.includes("Mobile") ? "preview-layout-mobile" : ""}`}>
                    <div className="preview-intro">
                      {logoData ? <img src={logoData} alt="Logo" className="publicCheckoutLogo" /> : null}
                      <div className="canvas-title">{item.data.title}</div>
                      {item.data.description ? <div className="canvas-muted">{item.data.description}</div> : null}
                    </div>
                    <div className="preview-form">
                      <div className="canvas-form-preview">
                        <div className="canvas-input"><span>Nombre completo</span></div>
                        <div className="canvas-input"><span>Teléfono</span></div>
                      </div>
                      <button type="button" className="canvas-cta">{item.data.cta}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
