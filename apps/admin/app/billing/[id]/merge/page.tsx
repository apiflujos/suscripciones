import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { mergeDuplicateSubscriptions } from "../../../subscriptions/actions";
import { loadSubscriptionPage } from "../../subscriptionPage";

export const dynamic = "force-dynamic";

/** Fusionar suscripciones duplicadas del mismo contacto y producto, conservando esta. */
export default async function MergeDuplicatesPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await loadSubscriptionPage(params, searchParams);
  const { row, csrfToken, returnTo, duplicateCount } = ctx;
  const duplicates = Math.max(0, duplicateCount - 1);

  return (
    <PageShell
      title="Fusionar suscripciones duplicadas"
      subtitle={ctx.subtitle}
      crumbs={ctx.crumbs("Fusionar duplicadas")}
      backHref={returnTo}
      notice={ctx.error ? { tone: "error", text: ctx.error } : null}
    >
      {duplicates === 0 ? (
        <PageSection title="No hay duplicadas">
          <p style={{ margin: 0 }}>Este contacto no tiene otras suscripciones del mismo producto.</p>
        </PageSection>
      ) : (
        <form action={mergeDuplicateSubscriptions} className="page-shell-body">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="customerId" value={row.customerId} />
          {row.productId ? <input type="hidden" name="productId" value={row.productId} /> : null}
          {row.planId ? <input type="hidden" name="planId" value={row.planId} /> : null}
          <input type="hidden" name="keepSubscriptionId" value={row.id} />
          {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
          <input type="hidden" name="returnTo" value={returnTo} />
          <PageSection title="Confirma la fusión">
            <p style={{ margin: 0 }}>
              Se fusionarán <strong>{duplicates}</strong> suscripciones duplicadas de este contacto y producto, y se conservará
              esta como principal.
            </p>
            <label className="field ui-alert-warn" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" name="confirm" value="1" required />
              <span>Entiendo que las duplicadas dejarán de existir.</span>
            </label>
          </PageSection>
          <FormActions cancelHref={returnTo}>
            <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Fusionando...">
              Fusionar duplicadas
            </PendingButton>
          </FormActions>
        </form>
      )}
    </PageShell>
  );
}
