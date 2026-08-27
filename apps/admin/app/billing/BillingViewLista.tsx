import { SubscriptionDetailModalWrapper } from "./SubscriptionDetailModalWrapper";
import { PaymentLinkModalButton } from "./PaymentLinkModalButton";
import { TokenizationLinkModalButton } from "./TokenizationLinkModalButton";
import { PaymentHistoryButton } from "./PaymentHistoryButton";
import { ChangePlanButton } from "./ChangePlanButton";
import { ManualChargeButton } from "./ManualChargeButton";
import { ManualMarkPaidButton } from "./ManualMarkPaidButton";
import { ManualUnmarkPaidButton } from "./ManualUnmarkPaidButton";
import { MergeDuplicateSubscriptionsButton } from "./MergeDuplicateSubscriptionsButton";
import { DeleteSubscriptionButton } from "./DeleteSubscriptionButton";
import { buildSubscriptionDetail } from "./BillingCard";
import { formatCivilDate } from "./civilDate";
import { getCollectionStatusLabel } from "./billingDisplayHelpers";
import { splitProductDisplay } from "./billingDisplayHelpers";
import { RowActionsMenu } from "./RowActionsMenu";
import type { BillingCardContext, BillingRow } from "./billingTypes";

type BillingViewListaProps = {
  rows: BillingRow[];
  context: BillingCardContext;
};

export function BillingViewLista({ rows, context }: BillingViewListaProps) {
  return (
    <div className="billing-list">
      <div className="billing-list-header">
        <span>Cliente</span>
        <span>Plan</span>
        <span>Ciclo</span>
        <span>Próximo cobro</span>
        <span>Estado</span>
        <span>Método</span>
        <span>Acciones</span>
      </div>
      {rows.map((row) => {
        const paymentStatus = getCollectionStatusLabel({
          status: row.status,
          dueAt: row.vencimientoAt,
          graceDays: row.graceDays,
          collectionCyclePaid: row.collectionCyclePaid
        });
        const isAutoDebit = row.mode === "AUTO_DEBIT";
        // El cobro que viene para ESTE ciclo: el reintento agendado o su corte.
        const nextChargeAt = row.nextRetryAt || row.vencimientoAt || null;
        const isCanceled = row.status === "CANCELED";
        const isSuspended = row.status === "SUSPENDED";
        const isExpired = row.status === "EXPIRED";
        const isReactivatable = isCanceled || isExpired;
        const isInactive = isReactivatable || isSuspended;
        const alreadyPaidCurrentPeriod = Boolean(row.lastPaidInCurrentPeriod);
        const canManualCharge = Boolean(row.canManualCharge);
        const canManualMarkPaid = Boolean(row.canManualMarkPaid);
        const canManualUnmarkPaid = Boolean(row.canManualUnmarkPaid);
        const showManualCharge = isAutoDebit && !isInactive && canManualCharge;
        const showMarkPaid = !isInactive && !alreadyPaidCurrentPeriod && canManualMarkPaid;
        // Duplicados: el botón solo aparece en la suscripción que queda como
        // "principal" del grupo. Si no, se enviaría el merge desde una fila que
        // luego se va a borrar y el keepSubscriptionId no coincidiría.
        const duplicateKey = context.helpers.resolveDuplicateKey(row);
        const duplicateCount = context.helpers.duplicateCountByKey.get(duplicateKey) || 1;
        const keepRowId = context.helpers.duplicateKeepByKey.get(duplicateKey)?.id || row.id;
        const isDuplicateKeep = keepRowId === row.id;
        const contactHref = `/customers?${new URLSearchParams({
          tx: row.customerId,
          ...(row.tenantId ? { tenantId: row.tenantId } : {})
        }).toString()}`;
        const productHref = `/products?${new URLSearchParams({
          q: row.productName || row.planName || "",
          ...(row.tenantId ? { tenantId: row.tenantId } : {})
        }).toString()}`;
        const product = splitProductDisplay(row.productName || row.planName);
        const initials = row.customerName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join("") || "—";

        return (
          <div className="billing-list-row" key={`list-${row.id}`}>
            <div className="billing-list-cell billing-list-person" data-label="Cliente">
              <span className="billing-list-avatar" aria-hidden="true">{initials}</span>
              <span className="billing-list-person-copy">
                <a className="billing-list-name" href={contactHref}>{row.customerName}</a>
                <span className="billing-list-sub">{row.customerEmail || row.identificacion || "Sin datos de contacto"}</span>
              </span>
            </div>
            <div className="billing-list-cell billing-list-product" data-label="Plan">
              <a className="billing-list-link" href={productHref}>{product.name}</a>
              <span className="billing-list-sub">
                {product.sku ? <span className="billing-list-sku">SKU {product.sku}</span> : null}
                {product.sku ? " · " : ""}{row.cada}
              </span>
            </div>
            <div className="billing-list-cell billing-list-cycle" data-label="Ciclo">
              <span className="billing-list-cycle-n">{row.cycleNumber != null ? `#${row.cycleNumber}` : "—"}</span>
              <span className={`billing-list-sub ${row.collectionCyclePaid ? "is-ok" : "is-warn"}`}>
                {row.collectionCyclePaid ? "pagado" : "sin pagar"}
              </span>
            </div>
            <div className="billing-list-cell billing-list-next" data-label="Próximo cobro">
              {row.collectionCyclePaid ? (
                <>
                  <span>{formatCivilDate(row.vencimientoAt)}</span>
                  <span className="billing-list-sub is-ok">Ciclo cobrado</span>
                </>
              ) : nextChargeAt ? (
                <>
                  {formatCivilDate(nextChargeAt)}
                  <span className={`billing-list-sub ${row.daysLate > 0 ? "is-bad" : ""}`}>
                    {row.daysLate > 0 ? `Vencido hace ${row.daysLate} días` : row.nextRetryAt ? "Reintento programado" : "Fecha de corte"}
                  </span>
                </>
              ) : (
                <span className="billing-list-sub is-bad">Sin cobro programado</span>
              )}
            </div>
            <div className="billing-list-cell billing-list-status" data-label="Estado">
              <span
                className={`pill pill-sm ${paymentStatus === "Al día" ? "pill-ok" : paymentStatus === "En mora" ? "pill-bad" : "pill-warn"}`}
                title={`Cobro: ${paymentStatus} · Suscripción: ${row.estadoInfo.label}`}
              >
                {paymentStatus}
              </span>
            </div>
            <div className="billing-list-cell billing-list-method" data-label="Método">
              <span className="billing-list-method-name">{row.tipoPago}</span>
              <span className="billing-list-sub">{isAutoDebit ? (row.customerTokenized ? "Tarjeta registrada" : "Sin tarjeta") : "Link de pago"}</span>
            </div>
            <div className="billing-list-cell billing-list-more" data-label="Acciones">
              <RowActionsMenu>
                <SubscriptionDetailModalWrapper
                  subscription={buildSubscriptionDetail(row, context)}
                  csrfToken={context.data.csrfToken}
                  returnTo={context.data.returnTo}
                  tenants={context.data.tenants}
                  planOptions={context.data.planOptions}
                  notificationsTemplates={context.data.notificationsTemplates}
                  notificationsRules={context.data.notificationsRules}
                  chargeSubscriptionNow={context.actions.chargeSubscriptionNow}
                  markSubscriptionPaidManual={context.actions.markSubscriptionPaidManual}
                  unmarkSubscriptionPaidManual={context.actions.unmarkSubscriptionPaidManual}
                  mergeDuplicateSubscriptions={context.actions.mergeDuplicateSubscriptions}
                  sendWhatsAppPaymentLink={context.actions.sendWhatsAppPaymentLink}
                  sendWhatsAppTokenizationLink={context.actions.sendWhatsAppTokenizationLink}
                  updateSubscriptionTenants={context.actions.updateSubscriptionTenants}
                  changeSubscriptionPlan={context.actions.changeSubscriptionPlan}
                  updateSubscriptionBillingSettings={context.actions.updateSubscriptionBillingSettings}
                  deleteSubscription={context.actions.deleteSubscription}
                  suspendSubscription={context.actions.suspendSubscription}
                  cancelSubscription={context.actions.cancelSubscription}
                  resumeSubscription={context.actions.resumeSubscription}
                  activateSubscription={context.actions.activateSubscription}
                  className="ghost btn-compact btn-noicon billing-list-detail-button"
                >
                  Ver detalle
                </SubscriptionDetailModalWrapper>
                <ChangePlanButton
                  subscriptionId={row.id}
                  currentPlanId={row.productId || row.planId}
                  currentChargeAt={row.vencimientoAt}
                  currentShippingInCents={row.currentShippingInCents}
                  currentRequiresShipping={row.currentRequiresShipping}
                  currentPlanName={row.productName || row.planName}
                  currentPlanCurrency={row.moneda}
                  plans={context.data.planOptions}
                  csrfToken={context.data.csrfToken}
                  returnTo={context.data.returnTo}
                  tenantId={row.tenantId}
                  action={context.actions.changeSubscriptionPlan}
                />
                <PaymentHistoryButton
                  subscriptionId={row.id}
                  tenantId={row.tenantId}
                  label="Historial de pagos"
                />
                {showManualCharge ? (
                  <ManualChargeButton
                    action={context.actions.chargeSubscriptionNow}
                    csrfToken={context.data.csrfToken}
                    subscriptionId={row.id}
                    tenantId={row.tenantId}
                    returnTo={context.data.returnTo}
                    warnNotDue={!row.chargeDue}
                    warnAlreadyPaid={alreadyPaidCurrentPeriod}
                    manualChargeEnabled={row.manualChargeEnabled}
                  />
                ) : null}
                {showMarkPaid ? (
                  <ManualMarkPaidButton
                    action={context.actions.markSubscriptionPaidManual}
                    csrfToken={context.data.csrfToken}
                    subscriptionId={row.id}
                    tenantId={row.tenantId}
                    returnTo={context.data.returnTo}
                    warnAlreadyPaid={alreadyPaidCurrentPeriod}
                    manualMarkPaidEnabled={row.manualMarkPaidEnabled}
                  />
                ) : null}
                {canManualUnmarkPaid ? (
                  <ManualUnmarkPaidButton
                    action={context.actions.unmarkSubscriptionPaidManual}
                    csrfToken={context.data.csrfToken}
                    subscriptionId={row.id}
                    tenantId={row.tenantId}
                    returnTo={context.data.returnTo}
                  />
                ) : null}
                {!isInactive && !isAutoDebit ? (
                  <PaymentLinkModalButton
                    subscriptionId={row.id}
                    customerId={row.customerId}
                    tenantId={row.tenantId}
                    csrfToken={context.data.csrfToken}
                    returnTo={context.data.returnTo}
                    defaultAmountPesos={Math.trunc(Number(row.totalInCents || row.montoInCents || 0) / 100)}
                    notificationTemplates={context.data.notificationsTemplates}
                    notificationRules={context.data.notificationsRules}
                    paymentType="SUBSCRIPTION"
                    blockedReason={context.helpers.getPaymentLinkBlockedReason(row)}
                    action={context.actions.sendWhatsAppPaymentLink}
                  />
                ) : null}
                {isAutoDebit && !isInactive ? (
                  <TokenizationLinkModalButton
                    customerId={row.customerId}
                    productId={row.productId || undefined}
                    planId={row.planId}
                    tenantId={row.tenantId}
                    csrfToken={context.data.csrfToken}
                    returnTo={context.data.returnTo}
                    notificationTemplates={context.data.notificationsTemplates}
                    notificationRules={context.data.notificationsRules}
                    blockedReason={context.helpers.getTokenizationBlockedReason(row)}
                    action={context.actions.sendWhatsAppTokenizationLink}
                  />
                ) : null}
                {isSuspended ? (
                  <form action={context.actions.resumeSubscription}>
                    <input type="hidden" name="csrf" value={context.data.csrfToken} />
                    <input type="hidden" name="subscriptionId" value={row.id} />
                    {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
                    <button className="ghost btn-compact btn-green btn-noicon" type="submit" title="Reanudar suscripción">
                      Reanudar
                    </button>
                  </form>
                ) : null}
                {isReactivatable ? (
                  <form action={context.actions.activateSubscription}>
                    <input type="hidden" name="csrf" value={context.data.csrfToken} />
                    <input type="hidden" name="subscriptionId" value={row.id} />
                    {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
                    <input type="hidden" name="returnTo" value={context.data.returnTo} />
                    <button className="ghost btn-compact btn-green btn-noicon" type="submit" title="Reactivar suscripción">
                      Reactivar
                    </button>
                  </form>
                ) : null}
                {isDuplicateKeep && duplicateCount > 1 ? (
                  <MergeDuplicateSubscriptionsButton
                    action={context.actions.mergeDuplicateSubscriptions}
                    csrfToken={context.data.csrfToken}
                    customerId={row.customerId}
                    productId={row.productId || undefined}
                    planId={row.planId}
                    keepSubscriptionId={row.id}
                    tenantId={row.tenantId}
                    returnTo={context.data.returnTo}
                    duplicatesCount={duplicateCount - 1}
                  />
                ) : null}
                <DeleteSubscriptionButton
                  action={context.actions.deleteSubscription}
                  csrfToken={context.data.csrfToken}
                  subscriptionId={row.id}
                  tenantId={row.tenantId}
                  returnTo={context.data.returnTo}
                  label="Eliminar"
                />
              </RowActionsMenu>
            </div>
          </div>
        );
      })}
      {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
    </div>
  );
}
