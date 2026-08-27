"use client";

import React from "react";

export function DeleteSubscriptionButton({
  action,
  csrfToken,
  subscriptionId,
  tenantId,
  returnTo,
  label
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  subscriptionId: string;
  tenantId?: string;
  returnTo?: string;
  label?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("¿Eliminar esta suscripción y sus pagos relacionados?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <button
        className={label ? "ghost btn-compact btn-red btn-noicon" : "ghost btn-compact btn-red btn-delete-icon"}
        type="submit"
        aria-label="Eliminar suscripción"
        title="Eliminar suscripción"
      >
        {label || null}
      </button>
    </form>
  );
}
