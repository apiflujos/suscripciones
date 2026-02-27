"use client";

import { useMemo, useRef, useState } from "react";

type AcceptanceLinks = {
  termsUrl: string;
  personalDataUrl: string;
};

type Props = {
  publicKey: string;
  apiBaseUrl: string;
  action: string;
  acceptance?: AcceptanceLinks | null;
  submitLabel?: string;
};

function sanitizeNumber(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeExpYear(value: string) {
  const v = sanitizeNumber(value);
  if (v.length === 4) return v.slice(-2);
  return v;
}

function formatCardNumber(value: string) {
  const digits = sanitizeNumber(value).slice(0, 19);
  const groups = [];
  for (let i = 0; i < digits.length; i += 4) groups.push(digits.slice(i, i + 4));
  return groups.join(" ");
}

function mapWompiError(json: any) {
  const messages = json?.error?.messages;
  if (messages && typeof messages === "object") {
    const flat = Object.values(messages)
      .flat()
      .filter((x) => typeof x === "string") as string[];
    if (flat.length) return flat.join(" ");
  }
  return json?.error?.type ? String(json.error.type) : "";
}

export function WompiCardTokenizeForm({ publicKey, apiBaseUrl, action, acceptance, submitLabel }: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const tokenRef = useRef<HTMLInputElement | null>(null);

  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPersonal, setAcceptedPersonal] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const requiresAcceptance = useMemo(() => Boolean(acceptance?.termsUrl || acceptance?.personalDataUrl), [acceptance]);
  const canTokenize = useMemo(() => {
    if (!requiresAcceptance) return true;
    const termsOk = acceptance?.termsUrl ? acceptedTerms : true;
    const personalOk = acceptance?.personalDataUrl ? acceptedPersonal : true;
    return termsOk && personalOk;
  }, [requiresAcceptance, acceptance, acceptedTerms, acceptedPersonal]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");

    if (!publicKey) {
      setError("Falta configurar la llave pública de Wompi.");
      return;
    }
    if (!canTokenize) {
      setError("Debes aceptar los terminos para continuar.");
      return;
    }

    const payload = {
      number: sanitizeNumber(cardNumber),
      cvc: sanitizeNumber(cvc),
      exp_month: sanitizeNumber(expMonth),
      exp_year: normalizeExpYear(expYear),
      card_holder: String(cardHolder || "").trim()
    };

    if (!payload.number || !payload.cvc || !payload.exp_month || !payload.exp_year || !payload.card_holder) {
      setError("Completa los datos de la tarjeta.");
      return;
    }

    try {
      setLoading(true);
      const base = String(apiBaseUrl || "").trim().replace(/\/$/, "");
      const res = await fetch(`${base}/tokens/cards`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${publicKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(mapWompiError(json) || "No pudimos tokenizar la tarjeta. Verifica los datos.");
        setLoading(false);
        return;
      }
      const token = String(json?.data?.id || json?.id || "").trim();
      if (!token) {
        setError("No pudimos tokenizar la tarjeta. Intenta nuevamente.");
        setLoading(false);
        return;
      }
      if (tokenRef.current) tokenRef.current.value = token;
      const form = formRef.current;
      if (!form) return;
      form.submit();
    } catch (err: any) {
      setError(String(err?.message || "No pudimos tokenizar la tarjeta."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form ref={formRef} method="POST" action={action} onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          {error}
        </div>
      ) : null}

      <div className="field">
        <label>Número de tarjeta</label>
        <input
          className="input"
          inputMode="numeric"
          autoComplete="cc-number"
          value={cardNumber}
          onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
          placeholder="4111 1111 1111 1111"
          required
        />
      </div>

      <div className="field">
        <label>Nombre en la tarjeta</label>
        <input
          className="input"
          autoComplete="cc-name"
          value={cardHolder}
          onChange={(e) => setCardHolder(e.target.value)}
          placeholder="Nombre completo"
          required
        />
      </div>

      <div className="field" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <label>Mes</label>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="cc-exp-month"
            value={expMonth}
            onChange={(e) => setExpMonth(sanitizeNumber(e.target.value).slice(0, 2))}
            placeholder="MM"
            required
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label>Año</label>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="cc-exp-year"
            value={expYear}
            onChange={(e) => setExpYear(sanitizeNumber(e.target.value).slice(0, 4))}
            placeholder="YY"
            required
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label>CVC</label>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="cc-csc"
            value={cvc}
            onChange={(e) => setCvc(sanitizeNumber(e.target.value).slice(0, 4))}
            placeholder="CVC"
            required
          />
        </div>
      </div>

      {requiresAcceptance ? (
        <div className="field" style={{ display: "grid", gap: 8 }}>
          {acceptance?.termsUrl ? (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
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
              <input type="checkbox" checked={acceptedPersonal} onChange={(e) => setAcceptedPersonal(e.target.checked)} />
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

      <input ref={tokenRef} type="hidden" name="wompi_token" value="" />
      <input type="hidden" name="accept_terms" value={acceptedTerms ? "1" : "0"} />
      <input type="hidden" name="accept_personal_data" value={acceptedPersonal ? "1" : "0"} />

      <button className="btn" type="submit" disabled={loading}>
        {loading ? "Tokenizando..." : submitLabel || "Guardar método de pago"}
      </button>
    </form>
  );
}
