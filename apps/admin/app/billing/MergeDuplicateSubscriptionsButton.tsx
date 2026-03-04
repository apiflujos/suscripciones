"use client";

import React from "react";

export function MergeDuplicateSubscriptionsButton({
  action,
  csrfToken,
  customerId,
  planId,
  keepSubscriptionId,
  tenantId,
  returnTo,
  duplicatesCount
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  customerId: string;
  planId: string;
  keepSubscriptionId: string;
  tenantId?: string;
  returnTo?: string;
  duplicatesCount: number;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const ok = confirm(
          `Se fusionarán ${duplicatesCount} suscripciones duplicadas de este cliente/producto y se conservará esta tarjeta como principal. ¿Continuar?`
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="keepSubscriptionId" value={keepSubscriptionId} />
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <button className="ghost btn-compact btn-noicon btn-amber" type="submit" title="Fusionar suscripciones duplicadas">
        Fusionar duplicadas ({duplicatesCount})
      </button>
    </form>
  );
}
