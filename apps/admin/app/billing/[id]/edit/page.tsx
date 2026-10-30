import { PageShell } from "../../../ui/PageShell";
import { updateSubscriptionBillingSettings } from "../../actions";
import { deleteSubscription } from "../../../subscriptions/actions";
import { SubscriptionEditForm } from "../../SubscriptionEditForm";
import { withReturnTo } from "../../../lib/returnTo";
import { loadSubscriptionPage } from "../../subscriptionPage";

export const dynamic = "force-dynamic";

/** Editar reglas de cobro y ciclo de una suscripción (antes era un modal dentro del de detalle). */
export default async function EditSubscriptionPage({
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
      title="Editar producto y facturación"
      subtitle={ctx.subtitle}
      crumbs={ctx.crumbs("Editar")}
      backHref={returnTo}
      notice={ctx.error ? { tone: "error", text: ctx.error } : null}
      width="form"
    >
      <SubscriptionEditForm
        subscriptionId={row.id}
        tenantId={row.tenantId}
        csrfToken={csrfToken}
        returnTo={returnTo}
        currentChargeAt={row.vencimientoAt}
        periodStartAt={row.periodoInicioAt}
        currentPlanId={row.productId || row.planId}
        currentPlanName={row.productName || row.planName}
        currentPlanCurrency={row.moneda}
        currentShippingInCents={row.currentShippingInCents}
        currentRequiresShipping={row.currentShippingInCents > 0}
        planIntervalUnit={row.planIntervalUnit}
        planIntervalCount={row.planIntervalCount}
        plans={planOptions}
        changeSubscriptionPlan={() => undefined}
        cycleStartDay={row.cycleStartDay}
        paymentDay={row.paymentDay}
        paymentTiming={row.paymentTiming}
        graceDays={row.graceDays}
        collectionMode={row.mode || undefined}
        updateSubscriptionBillingSettings={updateSubscriptionBillingSettings}
        deleteSubscription={deleteSubscription}
        globalConfig={{ graceDays: row.graceDays }}
        cancelHref={returnTo}
        cyclesHref={withReturnTo(`${ctx.detailHref.split("?")[0]}?tab=ciclos`, returnTo)}
      />
    </PageShell>
  );
}
