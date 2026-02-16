"use client";

import { useEffect, useRef, useState } from "react";
import { PendingButton } from "../ui/PendingButton";

type Defaults = {
  baseUrl?: string;
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
  const [baseUrl, setBaseUrl] = useState<string>(defaults.baseUrl || "");
  const [primaryColor, setPrimaryColor] = useState<string>(((defaults as any).primaryColor as string) || "#002b5b");
  const [logoData, setLogoData] = useState<string>(((defaults as any).logoUrl as string) || "");
  const [fontFamily, setFontFamily] = useState<string>(((defaults as any).fontFamily as string) || "Manrope");
  const [redirectUrl, setRedirectUrl] = useState<string>(((defaults as any).redirectUrl as string) || "");
  const baseRef = useRef<HTMLInputElement | null>(null);

  function next() {
    setStep((s) => Math.min(3, s + 1));
  }

  function prev() {
    setStep((s) => Math.max(1, s - 1));
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const origin = window.location.origin;
    setBaseUrl((prev) => prev || origin);
  }, []);

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

  useEffect(() => {
    if (!baseUrl) return;
    const normalized = baseUrl.replace(/\/$/, "");
    setRedirectUrl(`${normalized}/gracias`);
  }, [baseUrl]);

  return (
    <form action={onSave} className="wizard" style={{ display: "grid", gap: 14 }}>
      <input type="hidden" name="csrf" value={csrfToken} />

      <div className="wizard-steps">
        {["Marca", "Dominio y contacto", "Gracias"].map((label, idx) => (
          <div key={label} className={`wizard-step ${step === idx + 1 ? "is-active" : step > idx + 1 ? "is-done" : ""}`}>
            <span>{idx + 1}</span>
            <small>{label}</small>
          </div>
        ))}
      </div>

      {step === 1 ? (
        <div className="wizard-panel">
          <div className="field">
            <label>Logo</label>
            <div className="file-row">
              <input type="file" accept="image/*" onChange={onLogoFile} />
              {logoData ? <img src={logoData} alt="Logo" className="logo-preview" /> : null}
            </div>
            <input type="hidden" name="publicLogoUrl" value={logoData} />
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
            <select className="select" name="publicFontFamily" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
              {["Manrope", "Sora", "Space Grotesk", "Outfit", "Plus Jakarta Sans", "IBM Plex Sans", "Montserrat"].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="wizard-panel">
          <div className="field">
            <label>Email de contacto</label>
            <input className="input" name="publicContactEmail" defaultValue={defaults.contactEmail || ""} placeholder="mdv.subs@apiflujos.com" />
          </div>
          <div className="field">
            <label>Dominio (automático)</label>
            <input
              ref={baseRef}
              className="input"
              name="publicBaseUrl"
              value={baseUrl}
              placeholder="https://mdv.subs.apiflujos.com"
              readOnly
            />
            <div className="field-hint">Se usa el mismo dominio del panel.</div>
          </div>
          <div className="field">
            <label>Expiración del link (horas)</label>
            <input className="input" name="publicTokenExpiryHours" defaultValue={defaults.tokenExpiryHours || 24} />
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="wizard-panel">
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
            <input className="input" name="publicRedirectUrl" value={redirectUrl} readOnly />
            <div className="field-hint">
              Se generará: <strong>{redirectUrl}</strong>
            </div>
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
        </div>
        {step < 3 ? (
          <button className="primary" type="button" onClick={next}>
            Siguiente
          </button>
        ) : (
          <PendingButton className="primary" type="submit" pendingText="Guardando...">
            Guardar
          </PendingButton>
        )}
      </div>

      <div className="wizard-preview" style={{ ["--preview-color" as any]: primaryColor, fontFamily }}>
        <div className="preview-badge">Preview</div>
        {logoData ? <img src={logoData} alt="Logo" className="logo-preview" /> : null}
        <div className="preview-title">Checkout público</div>
        <div className="preview-subtitle">Previsualiza la marca global.</div>
        {baseUrl ? <div className="preview-link">{baseUrl}</div> : null}
      </div>
    </form>
  );
}
