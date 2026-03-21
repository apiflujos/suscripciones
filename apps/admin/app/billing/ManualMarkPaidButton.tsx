"use client";

import React, { useRef } from "react";

export function ManualMarkPaidButton({
  action,
  csrfToken,
  subscriptionId,
  tenantId,
  returnTo,
  warnAlreadyPaid
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  subscriptionId: string;
  tenantId?: string | null;
  returnTo?: string;
  warnAlreadyPaid: boolean;
}) {
  const methodRef = useRef<HTMLInputElement | null>(null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (warnAlreadyPaid) {
          const ok = confirm("Esta suscripción ya tiene un pago aprobado en el periodo actual. ¿Deseas marcarla como pagada manualmente de todas formas?");
          if (!ok) {
            e.preventDefault();
            return;
          }
        }
        const raw = prompt("¿Cómo se pagó? Escribe: Transferencia, Bre-B o Efectivo.", "Transferencia") || "";
        const normalized = raw.trim().toUpperCase().replace(/\s+/g, "");
        const method =
          normalized === "TRANSFERENCIA"
            ? "TRANSFERENCIA"
            : normalized === "BRE-B" || normalized === "BREB"
              ? "BREB"
              : normalized === "EFECTIVO"
                ? "EFECTIVO"
                : "";
        if (!method) {
          alert("Método inválido. Usa: Transferencia, Bre-B o Efectivo.");
          e.preventDefault();
          return;
        }
        if (methodRef.current) methodRef.current.value = method;
      }}
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      <input ref={methodRef} type="hidden" name="manualMethod" value="" />
      <button className="ghost btn-compact btn-amber btn-noicon" type="submit" title="Marcar como pagada manualmente">
        Marcar pagada
      </button>
    </form>
  );
}
