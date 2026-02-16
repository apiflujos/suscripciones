"use client";

import { useEffect, useRef, useState } from "react";
import { PendingButton } from "../ui/PendingButton";

type Defaults = {
  baseUrl?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  contactEmail?: string;
  tokenExpiryHours?: number;
};

export function PublicCheckoutDefaultsWizard({
  defaults,
  csrfToken,
  onSave
}: {
  defaults: Defaults;
  csrfToken: string;
  onSave: (formData: FormData) => void;
}) {
  const [step, setStep] = useState(1);
  const baseRef = useRef<HTMLInputElement | null>(null);

  function next() {
    setStep((s) => Math.min(4, s + 1));
  }

  function prev() {
    setStep((s) => Math.max(1, s - 1));
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (defaults.baseUrl) return;
    if (baseRef.current && !baseRef.current.value) {
      baseRef.current.value = window.location.origin;
    }
  }, [defaults.baseUrl]);

  return (
    <form action={onSave} className="wizard" style={{ display: "grid", gap: 14 }}>
      <input type="hidden" name="csrf" value={csrfToken} />

      <div className="wizard-steps">
        {["Branding", "Contenido", "Dominio", "Expiración"].map((label, idx) => (
          <div key={label} className={`wizard-step ${step === idx + 1 ? "is-active" : step > idx + 1 ? "is-done" : ""}`}>
            <span>{idx + 1}</span>
            <small>{label}</small>
          </div>
        ))}
      </div>

      {step === 1 ? (
        <div className="wizard-panel">
          <div className="field">
            <label>Título general</label>
            <input className="input" name="publicTitle" defaultValue={defaults.title || ""} placeholder="Activa tu suscripción" />
          </div>
          <div className="field">
            <label>Subtítulo</label>
            <input className="input" name="publicSubtitle" defaultValue={defaults.subtitle || ""} placeholder="Guarda tu método de pago" />
          </div>
          <div className="field">
            <label>Logo (URL)</label>
            <input className="input" name="publicLogoUrl" defaultValue={(defaults as any).logoUrl || ""} placeholder="https://..." />
          </div>
          <div className="field">
            <label>Color primario</label>
            <input className="input" name="publicPrimaryColor" defaultValue={(defaults as any).primaryColor || ""} placeholder="#0f172a" />
          </div>
          <div className="field">
            <label>Fuente</label>
            <input className="input" name="publicFontFamily" defaultValue={(defaults as any).fontFamily || ""} placeholder="Manrope" />
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="wizard-panel">
          <div className="field">
            <label>Descripción</label>
            <textarea className="input" name="publicDescription" defaultValue={defaults.description || ""} rows={3} />
          </div>
          <div className="field">
            <label>Email de contacto</label>
            <input className="input" name="publicContactEmail" defaultValue={defaults.contactEmail || ""} placeholder="mdv.subs@apiflujos.com" />
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="wizard-panel">
          <div className="field">
            <label>URL pública base</label>
            <input ref={baseRef} className="input" name="publicBaseUrl" defaultValue={defaults.baseUrl || ""} placeholder="https://mdv.subs.apiflujos.com" />
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="wizard-panel">
          <div className="field">
            <label>Expiración del link (horas)</label>
            <input className="input" name="publicTokenExpiryHours" defaultValue={defaults.tokenExpiryHours || 24} />
          </div>
          <div className="field">
            <label>Título de gracias</label>
            <input className="input" name="publicSuccessTitle" defaultValue={(defaults as any).successTitle || ""} />
          </div>
          <div className="field">
            <label>Subtítulo de gracias</label>
            <input className="input" name="publicSuccessSubtitle" defaultValue={(defaults as any).successSubtitle || ""} />
          </div>
          <div className="field">
            <label>Texto botón gracias</label>
            <input className="input" name="publicSuccessButtonText" defaultValue={(defaults as any).successButtonText || ""} />
          </div>
          <div className="field">
            <label>URL redirección gracias</label>
            <input className="input" name="publicRedirectUrl" defaultValue={(defaults as any).redirectUrl || ""} placeholder="https://..." />
          </div>
        </div>
      ) : null}

      <div className="wizard-footer">
        <div style={{ display: "flex", gap: 8 }}>
          {step > 1 ? (
            <button className="ghost" type="button" onClick={prev}>
              Atrás
            </button>
          ) : null}
          {step < 4 ? (
            <button className="secondary" type="button" onClick={next}>
              Siguiente
            </button>
          ) : null}
        </div>
        <PendingButton className="primary" type="submit" pendingText="Guardando...">
          Guardar
        </PendingButton>
      </div>
    </form>
  );
}
