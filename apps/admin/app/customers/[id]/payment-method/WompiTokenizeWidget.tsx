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
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const form = host.closest("form");
    if (!form) return;

    if (normalizedPublicKey && canTokenize) return;

    const prevScripts = Array.from(form.querySelectorAll("script")).filter((s) => {
      const src = String(s.getAttribute("src") || "");
      return (
        s.getAttribute("data-wompi-widget") === "tokenize" ||
        s.getAttribute("data-public-key") ||
        src.includes("wompi")
      );
    });
    for (const s of prevScripts) s.remove();
    const prevButton = form.querySelector(".waybox-button");
    if (prevButton) prevButton.remove();
  }, [normalizedPublicKey, canTokenize]);

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
      {normalizedPublicKey && canTokenize ? (
        <script
          key={`wompi-tokenize-${normalizedPublicKey}`}
          src="https://checkout.wompi.co/widget.js"
          data-render="button"
          data-widget-operation="tokenize"
          data-public-key={normalizedPublicKey}
          data-wompi-widget="tokenize"
        ></script>
      ) : null}
      <div ref={hostRef} />
    </div>
  );
}
