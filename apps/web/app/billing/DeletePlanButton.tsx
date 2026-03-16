"use client";

export function DeletePlanButton({
  action,
  csrfToken,
  subscriptionId,
  planId,
  tenantId
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  subscriptionId: string;
  planId: string;
  tenantId?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("¿Eliminar el plan y su suscripción?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="planId" value={planId} />
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar plan" title="Eliminar plan" />
    </form>
  );
}
