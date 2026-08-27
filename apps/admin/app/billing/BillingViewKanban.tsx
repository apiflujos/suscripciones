import { SubscriptionDetailModalWrapper } from "./SubscriptionDetailModalWrapper";
import { PaymentLinkModalButton } from "./PaymentLinkModalButton";
import { TokenizationLinkModalButton } from "./TokenizationLinkModalButton";
import { PaymentHistoryButton } from "./PaymentHistoryButton";
import { ManualChargeButton } from "./ManualChargeButton";
import { ManualMarkPaidButton } from "./ManualMarkPaidButton";
import { DeleteSubscriptionButton } from "./DeleteSubscriptionButton";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildSubscriptionDetail } from "./BillingCard";
import { fmtMoney, getCollectionStatusLabel } from "./billingDisplayHelpers";
import { formatCivilDate } from "./civilDate";
import type { BillingCardContext, BillingRow } from "./billingTypes";

type BillingViewKanbanProps = {
  rows: BillingRow[];
  context: BillingCardContext;
};

export function BillingViewKanban({ rows, context }: BillingViewKanbanProps) {
  const columns = ["Al día", "En gracia", "En mora"];
  const grouped = new Map<string, BillingRow[]>();
  for (const column of columns) grouped.set(column, []);
  for (const row of rows) {
    const paymentStatus = getCollectionStatusLabel({
      status: row.status,
      dueAt: row.vencimientoAt,
      graceDays: row.graceDays,
      collectionCyclePaid: row.collectionCyclePaid
    });
    const key = paymentStatus === "En mora" ? "En mora" : paymentStatus === "En gracia" ? "En gracia" : "Al día";
    grouped.get(key)?.push(row);
  }

  return (
    <div className="billing-kanban">
      {columns.map((column, index) => (
        <div className="billing-kanban-column" data-idx={index + 1} key={`kanban-${column}`}>
          <div className="billing-kanban-title">
            <span>{column}</span>
            <span className="pill pill-sm pill-muted">{grouped.get(column)?.length || 0}</span>
          </div>
          <div className="billing-kanban-list">
            {(grouped.get(column) || []).map((row) => {
              const isAutoDebit = row.mode === "AUTO_DEBIT";
              const isCanceled = row.status === "CANCELED";
              const isSuspended = row.status === "SUSPENDED";
              const isExpired = row.status === "EXPIRED";
              const isReactivatable = isCanceled || isExpired;
              const isInactive = isReactivatable || isSuspended;
              const alreadyPaidCurrentPeriod = Boolean(row.lastPaidInCurrentPeriod);
              const showManualCharge = isAutoDebit && !isInactive && Boolean(row.canManualCharge);
              const showMarkPaid = !isInactive && !alreadyPaidCurrentPeriod && Boolean(row.canManualMarkPaid);
              const itemPaymentStatus = getCollectionStatusLabel({
                status: row.status,
                dueAt: row.vencimientoAt,
                graceDays: row.graceDays,
                collectionCyclePaid: row.collectionCyclePaid
              });
              return (
                <div key={`kanban-item-${row.id}`} className="billing-kanban-card">
                  <SubscriptionDetailModalWrapper
                    className="billing-kanban-card-button"
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
                  >
                    <div
                      className="billing-kanban-summary"
                      title={`Suscripción: ${row.estadoInfo.label}`}
                    >
                      <div className="billing-kanban-name">{row.customerName}</div>
                      <div className="billing-kanban-sub">{row.productName || row.planName || "—"}</div>
                      <div className="billing-kanban-meta">
                        <span>{fmtMoney(row.totalInCents ?? row.montoInCents, row.moneda)}</span>
                        <span>·</span>
                        <span>{formatCivilDate(row.vencimientoAt)}</span>
                      </div>
                      <div className="billing-kanban-sub">{row.tipoTx} · {row.cada}</div>
                      <div className="billing-kanban-badges">
                        <span className={`pill pill-sm ${itemPaymentStatus === "Al día" ? "pill-ok" : itemPaymentStatus === "En mora" ? "pill-bad" : "pill-warn"}`}>
                          {itemPaymentStatus}
                        </span>
                      </div>
                    </div>
                  </SubscriptionDetailModalWrapper>
                  <div className="billing-kanban-card-actions">
                    <RowActionsMenu label="Acciones de la suscripción">
                      <PaymentHistoryButton subscriptionId={row.id} tenantId={row.tenantId} label="Historial de pagos" />
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
            {(grouped.get(column) || []).length === 0 ? <div className="billing-kanban-empty">Sin registros</div> : null}
          </div>
        </div>
      ))}
      {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
    </div>
  );
}

