"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";

type CheckoutConfig = {
  planBaseUrl?: string | null;
  subscriptionBaseUrl?: string | null;
  tokenExpiryHours?: number | null;
  logoUrl?: string | null;
  planTitle?: string | null;
  planDescription?: string | null;
  subscriptionTitle?: string | null;
  subscriptionDescription?: string | null;
  planWompiTitle?: string | null;
  planWompiDescription?: string | null;
  subscriptionWompiTitle?: string | null;
  subscriptionWompiDescription?: string | null;
};

export function CheckoutConfigPanel({
  defaults,
  csrfToken,
  onSave,
  inlineState
}: {
  defaults: CheckoutConfig;
  csrfToken: string;
  onSave: (formData: FormData) => void;
  inlineState: { action: string; status: string; errorText: string };
}) {
  const [logoData, setLogoData] = useState<string>(defaults.logoUrl || "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [planBaseUrl, setPlanBaseUrl] = useState<string>(String(defaults.planBaseUrl || ""));
  const [subscriptionBaseUrl, setSubscriptionBaseUrl] = useState<string>(String(defaults.subscriptionBaseUrl || ""));
  const [tokenExpiryHours, setTokenExpiryHours] = useState<string>(String(defaults.tokenExpiryHours || 24));
  const [planTitle, setPlanTitle] = useState<string>(String(defaults.planTitle || "Paga tu plan"));
  const [planDescription, setPlanDescription] = useState<string>(String(defaults.planDescription || ""));
  const [subscriptionTitle, setSubscriptionTitle] = useState<string>(String(defaults.subscriptionTitle || "Activa tu suscripción"));
  const [subscriptionDescription, setSubscriptionDescription] = useState<string>(String(defaults.subscriptionDescription || ""));
  const [planWompiTitle, setPlanWompiTitle] = useState<string>(String(defaults.planWompiTitle || ""));
  const [planWompiDescription, setPlanWompiDescription] = useState<string>(String(defaults.planWompiDescription || ""));
  const [subscriptionWompiTitle, setSubscriptionWompiTitle] = useState<string>(String(defaults.subscriptionWompiTitle || ""));
  const [subscriptionWompiDescription, setSubscriptionWompiDescription] = useState<string>(String(defaults.subscriptionWompiDescription || ""));

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

  const previewPlan = useMemo(() => ({ title: planTitle, description: planDescription, cta: "Pagar plan" }), [planTitle, planDescription]);
  const previewSub = useMemo(
    () => ({ title: subscriptionTitle, description: subscriptionDescription, cta: "Guardar método" }),
    [subscriptionTitle, subscriptionDescription]
  );

  return (
    <form action={onSave} className="panel module" style={{ display: "grid", gap: 16 }}>
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="logoUrl" value={logoData} />

      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Configuración de checkout</strong>
          <div className="field-hint">Base URL, expiración y textos públicos.</div>
        </div>
        <button className="ghost" type="button" onClick={() => setPreviewOpen(true)}>
          Ver fullscreen
        </button>
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
          <label>Base URL Plan</label>
          <input className="input" name="planBaseUrl" value={planBaseUrl} onChange={(e) => setPlanBaseUrl(e.target.value)} placeholder="https://pagos.tu-dominio.com" />
        </div>
        <div className="field">
          <label>Base URL Suscripción</label>
          <input
            className="input"
            name="subscriptionBaseUrl"
            value={subscriptionBaseUrl}
            onChange={(e) => setSubscriptionBaseUrl(e.target.value)}
            placeholder="https://suscripciones.tu-dominio.com"
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>Expiración link (horas)</label>
          <input className="input" name="tokenExpiryHours" value={tokenExpiryHours} onChange={(e) => setTokenExpiryHours(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="panel module" style={{ margin: 0 }}>
          <div className="panel-header">
            <strong>Plan</strong>
          </div>
          <div className="field">
            <label>Título</label>
            <input className="input" name="planTitle" value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Descripción</label>
            <textarea className="input" name="planDescription" rows={3} value={planDescription} onChange={(e) => setPlanDescription(e.target.value)} />
          </div>
        </div>

        <div className="panel module" style={{ margin: 0 }}>
          <div className="panel-header">
            <strong>Suscripción</strong>
          </div>
          <div className="field">
            <label>Título</label>
            <input className="input" name="subscriptionTitle" value={subscriptionTitle} onChange={(e) => setSubscriptionTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Descripción</label>
            <textarea
              className="input"
              name="subscriptionDescription"
              rows={3}
              value={subscriptionDescription}
              onChange={(e) => setSubscriptionDescription(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="panel module" style={{ margin: 0 }}>
        <div className="panel-header">
          <strong>Textos Wompi (opcionales)</strong>
        </div>
        <div className="field-hint">
          Variables disponibles: <span className="pill">{`{contacto}`}</span>{" "}
          <span className="pill">{`{producto}`}</span>{" "}
          <span className="pill">{`{monto}`}</span>{" "}
          <span className="pill">{`{periodicidad}`}</span>{" "}
          <span className="pill">{`{fecha_expira}`}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div className="panel module" style={{ margin: 0 }}>
            <div className="panel-header">
              <strong>Plan</strong>
            </div>
            <div className="field">
              <label>Title Wompi</label>
              <input className="input" name="planWompiTitle" value={planWompiTitle} onChange={(e) => setPlanWompiTitle(e.target.value)} placeholder="{producto} · {contacto}" />
            </div>
            <div className="field">
              <label>Description Wompi</label>
              <input
                className="input"
                name="planWompiDescription"
                value={planWompiDescription}
                onChange={(e) => setPlanWompiDescription(e.target.value)}
                placeholder="{producto} · {monto}"
              />
            </div>
          </div>

          <div className="panel module" style={{ margin: 0 }}>
            <div className="panel-header">
              <strong>Suscripción</strong>
            </div>
            <div className="field">
              <label>Title Wompi</label>
              <input
                className="input"
                name="subscriptionWompiTitle"
                value={subscriptionWompiTitle}
                onChange={(e) => setSubscriptionWompiTitle(e.target.value)}
                placeholder="{producto} · {contacto}"
              />
            </div>
            <div className="field">
              <label>Description Wompi</label>
              <input
                className="input"
                name="subscriptionWompiDescription"
                value={subscriptionWompiDescription}
                onChange={(e) => setSubscriptionWompiDescription(e.target.value)}
                placeholder="{producto} · {periodicidad} · {monto}"
              />
            </div>
          </div>
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>
          Si dejas vacío, se usan textos por defecto.
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
        <PendingButton className="primary" type="submit" pendingText="Guardando...">
          Guardar
        </PendingButton>
      </div>

      <div className="panel module" style={{ margin: 0 }}>
        <div className="panel-header">
          <strong>Preview</strong>
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
              {logoData ? <img src={logoData} alt="Logo" className="logo-preview" /> : null}
              <div className="canvas-title">{item.data.title}</div>
              {item.data.description ? <div className="canvas-muted">{item.data.description}</div> : null}
              <div className="canvas-form-preview">
                <div className="canvas-input"><span>Nombre completo</span></div>
                <div className="canvas-input"><span>Email</span></div>
                <div className="canvas-input"><span>Teléfono</span></div>
              </div>
              <button type="button" className="canvas-cta">{item.data.cta}</button>
            </div>
          ))}
        </div>
      </div>

      {previewOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,10,10,0.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            padding: 16
          }}
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="panel module"
            style={{ width: "min(1100px, 96vw)", maxHeight: "90vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Preview fullscreen</strong>
              <button className="ghost" type="button" onClick={() => setPreviewOpen(false)}>
                Cerrar
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
                  {logoData ? <img src={logoData} alt="Logo" className="publicCheckoutLogo" /> : null}
                  <div className="canvas-title">{item.data.title}</div>
                  {item.data.description ? <div className="canvas-muted">{item.data.description}</div> : null}
                  <div className="canvas-form-preview">
                    <div className="canvas-input"><span>Nombre completo</span></div>
                    <div className="canvas-input"><span>Email</span></div>
                    <div className="canvas-input"><span>Teléfono</span></div>
                  </div>
                  <button type="button" className="canvas-cta">{item.data.cta}</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
