"use client";

import React from "react";

export function ManualUnmarkPaidButton({
  action,
  csrfToken,
  subscriptionId,
  tenantId,
  returnTo
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  subscriptionId: string;
  tenantId?: string | null;
  returnTo?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const ok = confirm("Vas a desmarcar el cobro manual y devolver la suscripción al ciclo anterior. ¿Continuar?");
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      <button className="ghost btn-compact btn-red btn-noicon" type="submit" title="Desmarcar cobro manual">
        Desmarcar cobro
      </button>
    </form>
  );
}
