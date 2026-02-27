"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AcceptanceLinks = {
  termsUrl: string;
  personalDataUrl: string;
};

export function WompiTokenizeWidget({
  publicKey,
  acceptance
}: {
  publicKey: string;
  acceptance?: AcceptanceLinks | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPersonal, setAcceptedPersonal] = useState(false);

  const requiresAcceptance = useMemo(() => Boolean(acceptance?.termsUrl || acceptance?.personalDataUrl), [acceptance]);
  const canTokenize = useMemo(() => {
    if (!requiresAcceptance) return true;
    const termsOk = acceptance?.termsUrl ? acceptedTerms : true;
    const personalOk = acceptance?.personalDataUrl ? acceptedPersonal : true;
    return termsOk && personalOk;
  }, [requiresAcceptance, acceptance, acceptedTerms, acceptedPersonal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Wompi widget expects the script to be a direct child of a POST form.
    const form = host.closest("form");
    if (!form) return;
    form.setAttribute("method", "POST");
    if (!form.getAttribute("action")) {
      const path = window.location.pathname;
      form.setAttribute("action", path);
    }

    const cleanup = () => {
      const prevScript = form.querySelector('script[data-wompi-widget="tokenize"]');
      if (prevScript) prevScript.remove();
      const prevButton = form.querySelector(".waybox-button");
      if (prevButton) prevButton.remove();
    };

    cleanup();
    if (!publicKey || !canTokenize) return;

    const script = document.createElement("script");
    script.src = "/wompi/widget";
    // Wompi widget is a classic script (not ESM). Using module breaks currentScript.
    script.setAttribute("data-render", "button");
    script.setAttribute("data-widget-operation", "tokenize");
    script.setAttribute("data-public-key", publicKey);
    script.setAttribute("data-wompi-widget", "tokenize");
    form.appendChild(script);

    const onSubmit = () => {
      const button = form.querySelector<HTMLButtonElement>(".waybox-button, button[type='submit']");
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      form.setAttribute("data-submitting", "true");
    };
    form.addEventListener("submit", onSubmit);

    return () => {
      cleanup();
      form.removeEventListener("submit", onSubmit);
    };
  }, [publicKey, canTokenize]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {requiresAcceptance ? (
        <div className="field" style={{ display: "grid", gap: 8 }}>
          {acceptance?.termsUrl ? (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                aria-required="true"
              />
              <span style={{ fontSize: 14 }}>
                Acepto los terminos y condiciones de Wompi.{" "}
                <a href={acceptance.termsUrl} target="_blank" rel="noreferrer">
                  Ver terminos
                </a>
                .
              </span>
            </label>
          ) : null}
          {acceptance?.personalDataUrl ? (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={acceptedPersonal}
                onChange={(e) => setAcceptedPersonal(e.target.checked)}
                aria-required="true"
              />
              <span style={{ fontSize: 14 }}>
                Autorizo el tratamiento de mis datos personales.{" "}
                <a href={acceptance.personalDataUrl} target="_blank" rel="noreferrer">
                  Ver autorizacion
                </a>
                .
              </span>
            </label>
          ) : null}
          {!canTokenize ? <div className="field-hint">Debes aceptar para continuar.</div> : null}
        </div>
      ) : null}
      <input type="hidden" name="accept_terms" value={acceptedTerms ? "1" : "0"} />
      <input type="hidden" name="accept_personal_data" value={acceptedPersonal ? "1" : "0"} />
      <div ref={hostRef} />
    </div>
  );
}
