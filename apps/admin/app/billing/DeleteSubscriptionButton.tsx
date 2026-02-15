"use client";

import React from "react";

export function DeleteSubscriptionButton({
  action,
  csrfToken,
  subscriptionId
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  subscriptionId: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("¿Eliminar esta suscripción?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <button className="icon-btn danger" type="submit" aria-label="Eliminar suscripción">
        🗑
      </button>
    </form>
  );
}
