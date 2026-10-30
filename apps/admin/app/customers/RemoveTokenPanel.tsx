"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormActions } from "../ui/PageShell";
import { mapSendError } from "./sendRules";
import "./customers.css";

/** Quitar el método de pago guardado: confirmación en dos pasos dentro de la página. */
export function RemoveTokenPanel({ customerId, returnTo }: { customerId: string; returnTo: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/customers/clear-payment-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setError(mapSendError(json?.error || "request_failed"));
        return;
      }
      const url = new URL(returnTo, "http://localhost");
      url.searchParams.set("tokenRemoved", "1");
      router.push(`${url.pathname}${url.search}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-shell-body">
      {asking ? (
        <div className="customers-alert is-error" role="alert">
          ¿Seguro que quieres quitar el método de pago guardado? Los cobros automáticos dejarán de funcionar hasta guardar uno nuevo.
        </div>
      ) : null}
      {error ? (
        <div className="customers-alert is-error" role="alert">
          {error}
        </div>
      ) : null}
      <FormActions cancelHref={returnTo} cancelLabel={asking ? "No, volver" : "Cancelar"}>
        {asking ? (
          <button className="primary btn-compact btn-red" type="button" disabled={busy} onClick={remove} autoFocus>
            {busy ? "Quitando..." : "Sí, quitar método de pago"}
          </button>
        ) : (
          <button className="primary btn-compact btn-red" type="button" data-loader="off" onClick={() => setAsking(true)}>
            Quitar método de pago
          </button>
        )}
      </FormActions>
    </div>
  );
}
