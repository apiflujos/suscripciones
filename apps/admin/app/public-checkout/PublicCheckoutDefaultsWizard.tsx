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
  const [domainMode, setDomainMode] = useState<"apiflujos" | "custom">(((defaults as any).domainMode as "apiflujos" | "custom") || "apiflujos");
  const [companyName, setCompanyName] = useState<string>(((defaults as any).companyName as string) || "");
  const [customDomain, setCustomDomain] = useState<string>(((defaults as any).customDomain as string) || "");
  const [primaryColor, setPrimaryColor] = useState<string>(((defaults as any).primaryColor as string) || "#002b5b");
  const [title, setTitle] = useState<string>(defaults.title || "");
  const [subtitle, setSubtitle] = useState<string>(defaults.subtitle || "");
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

  const suggestedSubdomain = companyName
    ? `${companyName
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 40)}.subs.apiflujos.com`
    : "";

  useEffect(() => {
    if (!baseRef.current) return;
    if (domainMode !== "apiflujos") return;
    if (!suggestedSubdomain) return;
    baseRef.current.value = `https://${suggestedSubdomain}`;
  }, [domainMode, suggestedSubdomain]);

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
            <input className="input" name="publicTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Activa tu suscripción" />
          </div>
          <div className="field">
            <label>Subtítulo</label>
            <input className="input" name="publicSubtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Guarda tu método de pago" />
          </div>
          <div className="field">
            <label>Logo (URL)</label>
            <input className="input" name="publicLogoUrl" defaultValue={(defaults as any).logoUrl || ""} placeholder="https://..." />
          </div>
          <div className="field">
            <label>Color primario</label>
            <div className="color-row">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                aria-label="Seleccionar color"
              />
              <input className="input" name="publicPrimaryColor" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#0f172a" />
            </div>
            <div className="color-swatches">
              {["#002b5b", "#0f172a", "#14532d", "#7c2d12", "#6d28d9"].map((c) => (
                <button key={c} type="button" className="color-swatch" style={{ background: c }} onClick={() => setPrimaryColor(c)} />
              ))}
            </div>
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
            <label>Nombre de la empresa</label>
            <input className="input" name="publicCompanyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Mi empresa" />
          </div>
          <div className="field">
            <label>Tipo de dominio</label>
            <select className="select" name="publicDomainMode" value={domainMode} onChange={(e) => setDomainMode(e.target.value as "apiflujos" | "custom")}>
              <option value="apiflujos">Dominio Apiflujos</option>
              <option value="custom">Dominio propio</option>
            </select>
          </div>
          <div className="field">
            <label>URL pública base</label>
            <input
              ref={baseRef}
              className="input"
              name="publicBaseUrl"
              defaultValue={defaults.baseUrl || ""}
              placeholder="https://mdv.subs.apiflujos.com"
              readOnly={domainMode === "apiflujos"}
            />
            {domainMode === "apiflujos" ? (
              <div className="field-hint">
                Se generará: <strong>https://{suggestedSubdomain}</strong>
              </div>
            ) : null}
          </div>
          {domainMode === "custom" ? (
            <div className="field">
              <label>Dominio propio</label>
              <input className="input" name="publicCustomDomain" value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="checkout.tuempresa.com" />
              <div className="field-hint">
                Instrucciones DNS: crea un registro <strong>CNAME</strong> apuntando tu dominio a <strong>mdv.subs.apiflujos.com</strong>. Luego espera propagación (10-60 min).
              </div>
            </div>
          ) : null}
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

      <div className="wizard-preview" style={{ ["--preview-color" as any]: primaryColor }}>
        <div className="preview-badge">Preview</div>
        <div className="preview-title">{title || "Activa tu suscripción"}</div>
        <div className="preview-subtitle">{subtitle || "Guarda tu método de pago"}</div>
        <button type="button" className="primary" style={{ width: "fit-content" }}>Continuar</button>
      </div>
    </form>
  );
}
