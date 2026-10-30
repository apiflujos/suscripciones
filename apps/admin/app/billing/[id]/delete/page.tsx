import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { resolveReturnTo } from "../../../lib/returnTo";
import { deleteSubscription } from "../../../subscriptions/actions";
import { loadSubscriptionPage } from "../../subscriptionPage";

export const dynamic = "force-dynamic";

/**
 * Eliminar una suscripción. La confirmación es de dos pasos dentro de la página
 * (marcar la casilla y luego pulsar el botón), sin capas flotantes.
 */
export default async function DeleteSubscriptionPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await loadSubscriptionPage(params, searchParams);
  const { row, csrfToken } = ctx;
  // Tras eliminar, la suscripción ya no existe: se vuelve a la lista, no al detalle.
  const afterDelete = resolveReturnTo(ctx.sp.returnTo, "/billing");
  const cancelHref = ctx.detailHref;

  return (
    <PageShell
      title="Eliminar suscripción"
      subtitle={ctx.subtitle}
      crumbs={ctx.crumbs("Eliminar")}
      backHref={cancelHref}
      notice={ctx.error ? { tone: "error", text: ctx.error } : null}
    >
      <form action={deleteSubscription} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="subscriptionId" value={row.id} />
        <input type="hidden" name="returnTo" value={afterDelete} />
        {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
        <PageSection title="Esta acción no se puede deshacer">
          <p style={{ margin: 0 }}>
            Se eliminará la suscripción de <strong>{row.customerName}</strong> ({row.productName || row.planName}) y los pagos
            relacionados.
          </p>
          <label className="field ui-alert-warn" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" name="confirm" value="1" required />
            <span>Entiendo que se eliminarán la suscripción y sus pagos.</span>
          </label>
        </PageSection>
        <FormActions cancelHref={cancelHref}>
          <PendingButton className="primary btn-compact btn-red" type="submit" pendingText="Eliminando...">
            Eliminar suscripción
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
