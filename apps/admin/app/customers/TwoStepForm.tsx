"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import "./customers.css";

/**
 * Acción destructiva en dos pasos, dentro de la página (sin capa encima):
 * primero un botón que pide confirmar, después "¿Seguro?" con Confirmar / No.
 * El envío es un formulario de una acción de servidor.
 */
export function TwoStepForm({
  action,
  fields,
  triggerLabel,
  prompt,
  confirmLabel,
  pendingText
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  triggerLabel: string;
  prompt: string;
  confirmLabel: string;
  pendingText: string;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button className="ghost btn-compact btn-red btn-noicon" type="button" data-loader="off" onClick={() => setAsking(true)}>
        {triggerLabel}
      </button>
    );
  }

  return (
    <form action={action} className="customers-confirm" role="group" aria-label={prompt}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p className="customers-confirm-text">{prompt}</p>
      <div className="customers-confirm-actions">
        <button className="ghost btn-compact" type="button" data-loader="off" autoFocus onClick={() => setAsking(false)}>
          No, volver
        </button>
        <PendingButton className="primary btn-compact btn-red" type="submit" pendingText={pendingText}>
          {confirmLabel}
        </PendingButton>
      </div>
    </form>
  );
}
