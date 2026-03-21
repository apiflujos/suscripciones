"use client";

import React from "react";

export function ManualChargeButton({
  action,
  csrfToken,
  subscriptionId,
  tenantId,
  returnTo,
  warnNotDue,
  warnAlreadyPaid
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  subscriptionId: string;
  tenantId?: string | null;
  returnTo?: string;
  warnNotDue: boolean;
  warnAlreadyPaid: boolean;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!warnNotDue && !warnAlreadyPaid) return;
        const parts: string[] = [];
        if (warnAlreadyPaid) {
          parts.push("Esta suscripción ya tiene un pago aprobado en el periodo actual.");
        }
        if (warnNotDue) {
          parts.push("La fecha de corte aún no se ha cumplido.");
        }
        const msg = `${parts.join(" ")} ¿Deseas cobrar igualmente?`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      <button className="ghost btn-compact btn-blue btn-pay" type="submit">
        Cobrar
      </button>
    </form>
  );
}
