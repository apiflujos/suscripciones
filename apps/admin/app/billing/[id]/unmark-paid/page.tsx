import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { unmarkSubscriptionPaidManual } from "../../actions";
import { loadSubscriptionPage } from "../../subscriptionPage";

export const dynamic = "force-dynamic";

/** Desmarcar un cobro manual y devolver la suscripción al ciclo anterior. */
export default async function UnmarkPaidPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await loadSubscriptionPage(params, searchParams);
  const { row, csrfToken, returnTo } = ctx;

  return (
    <PageShell
      title="Desmarcar cobro manual"
      subtitle={ctx.subtitle}
      crumbs={ctx.crumbs("Desmarcar cobro")}
      backHref={returnTo}
      notice={ctx.error ? { tone: "error", text: ctx.error } : null}
    >
      <form action={unmarkSubscriptionPaidManual} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="subscriptionId" value={row.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
        <PageSection title="Confirma la acción">
          <p style={{ margin: 0 }}>
            Vas a desmarcar el cobro manual y devolver la suscripción al ciclo anterior. El pago registrado dejará de contar
            para el periodo actual.
          </p>
          <label className="field ui-alert-warn" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" name="confirm" value="1" required />
            <span>Sí, quiero desmarcar este cobro.</span>
          </label>
        </PageSection>
        <FormActions cancelHref={returnTo}>
          <PendingButton className="primary btn-compact btn-red" type="submit" pendingText="Desmarcando...">
            Desmarcar cobro
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
