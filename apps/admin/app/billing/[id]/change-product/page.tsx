import { PageShell } from "../../../ui/PageShell";
import { changeSubscriptionPlan } from "../../actions";
import { ChangePlanForm } from "../../ChangePlanForm";
import { loadSubscriptionPage } from "../../subscriptionPage";

export const dynamic = "force-dynamic";

/** Cambiar el producto (y flete y fecha de pago) de una suscripción. */
export default async function ChangeProductPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await loadSubscriptionPage(params, searchParams);
  const { row, csrfToken, planOptions, returnTo } = ctx;

  return (
    <PageShell
      title="Cambiar producto de la suscripción"
      subtitle={ctx.subtitle}
      crumbs={ctx.crumbs("Cambiar producto")}
      backHref={returnTo}
      notice={ctx.error ? { tone: "error", text: ctx.error } : null}
      width="form"
    >
      <ChangePlanForm
        subscriptionId={row.id}
        currentPlanId={row.productId || row.planId}
        currentChargeAt={row.vencimientoAt}
        currentShippingInCents={row.currentShippingInCents}
        currentRequiresShipping={row.currentRequiresShipping}
        currentPlanName={row.productName || row.planName}
        currentPlanCurrency={row.moneda}
        plans={planOptions}
        csrfToken={csrfToken}
        returnTo={returnTo}
        tenantId={row.tenantId}
        action={changeSubscriptionPlan}
        cancelHref={returnTo}
      />
    </PageShell>
  );
}
