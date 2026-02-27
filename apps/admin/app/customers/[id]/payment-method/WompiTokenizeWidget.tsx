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

  const normalizedPublicKey = useMemo(() => {
    const raw = String(publicKey || "").trim();
    if (!raw) return "";
    const lowered = raw.toLowerCase();
    if (lowered === "undefined" || lowered === "null") return "";
    return raw;
  }, [publicKey]);

  const requiresAcceptance = useMemo(() => Boolean(acceptance?.termsUrl || acceptance?.personalDataUrl), [acceptance]);
  const showPlaceholder = useMemo(() => requiresAcceptance && !canTokenize, [requiresAcceptance, canTokenize]);
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

    const onSubmit = () => {
      const button = form.querySelector<HTMLButtonElement>(".waybox-button, button[type='submit'], button");
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      form.setAttribute("data-submitting", "true");
    };
    form.addEventListener("submit", onSubmit);

    return () => {
      form.removeEventListener("submit", onSubmit);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const form = host.closest("form");
    if (!form) return;

    const toggleButton = () => {
      const button = form.querySelector<HTMLButtonElement>(".waybox-button, button[type='submit'], button");
      if (!button) return;
      const shouldDisable = !canTokenize;
      button.disabled = shouldDisable;
      button.setAttribute("aria-disabled", shouldDisable ? "true" : "false");
      button.style.pointerEvents = shouldDisable ? "none" : "";
      button.style.opacity = shouldDisable ? "0.6" : "";
      form.setAttribute("data-locked", shouldDisable ? "true" : "false");
      if (shouldDisable) {
        button.setAttribute("data-locked", "true");
      } else {
        button.removeAttribute("data-locked");
      }
    };

    toggleButton();
    const observer = new MutationObserver(() => toggleButton());
    observer.observe(form, { childList: true, subtree: true });

    const onClickCapture = (event: MouseEvent) => {
      if (canTokenize) return;
      const target = event.target as HTMLElement | null;
      const button = target?.closest?.(".waybox-button, button");
      if (button) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    form.addEventListener("click", onClickCapture, true);

    return () => {
      observer.disconnect();
      form.removeEventListener("click", onClickCapture, true);
    };
  }, [canTokenize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const form = host.closest("form");
    if (!form) return;

    const cleanup = () => {
      form.querySelectorAll('script[data-wompi-widget="tokenize"]').forEach((node) => node.remove());
      form.querySelectorAll(".waybox-button").forEach((node) => node.remove());
    };

    cleanup();
    if (!normalizedPublicKey || !canTokenize) return;

    const script = document.createElement("script");
    script.src = "https://checkout.wompi.co/widget.js";
    script.setAttribute("data-render", "button");
    script.setAttribute("data-widget-operation", "tokenize");
    script.setAttribute("data-public-key", normalizedPublicKey);
    script.setAttribute("data-wompi-widget", "tokenize");
    form.appendChild(script);

    return () => {
      cleanup();
    };
  }, [normalizedPublicKey, canTokenize]);

  return (
    <>
      {requiresAcceptance ? (
        <div className="field publicCheckoutAcceptance">
          {acceptance?.termsUrl ? (
            <label className="publicCheckoutCheckbox">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                aria-required="true"
              />
              <span className="publicCheckoutCheckboxText">
                Acepto los terminos y condiciones de Wompi.{" "}
                <a href={acceptance.termsUrl} target="_blank" rel="noreferrer">
                  Ver terminos
                </a>
                .
              </span>
            </label>
          ) : null}
          {acceptance?.personalDataUrl ? (
            <label className="publicCheckoutCheckbox">
              <input
                type="checkbox"
                checked={acceptedPersonal}
                onChange={(e) => setAcceptedPersonal(e.target.checked)}
                aria-required="true"
              />
              <span className="publicCheckoutCheckboxText">
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
      {showPlaceholder ? (
        <button type="button" className="publicCheckoutPlaceholderButton" disabled aria-disabled="true">
          Guardar método de pago
        </button>
      ) : null}
      <input type="hidden" name="accept_terms" value={acceptedTerms ? "1" : "0"} />
      <input type="hidden" name="accept_personal_data" value={acceptedPersonal ? "1" : "0"} />
      <div ref={hostRef} />
    </>
  );
}
