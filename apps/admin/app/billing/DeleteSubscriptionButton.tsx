"use client";

import React from "react";

export function DeleteSubscriptionButton({
  action,
  csrfToken,
  subscriptionId,
  tenantId
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  subscriptionId: string;
  tenantId?: string;
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
      <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar suscripción" title="Eliminar suscripción" />
    </form>
  );
}
