import { SubscriptionDetailModalWrapper } from "./SubscriptionDetailModalWrapper";
import { PaymentLinkModalButton } from "./PaymentLinkModalButton";
import { TokenizationLinkModalButton } from "./TokenizationLinkModalButton";
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
              const isInactive = isCanceled || isSuspended || isExpired;
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
                    {!isInactive && !isAutoDebit ? (
                      context.helpers.resolveRowCheckoutUrl(row) ? (
                        <a
                          className="ghost btn-compact btn-send btn-highlight"
                          href={context.helpers.resolveRowCheckoutUrl(row)}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir link de pago"
                        >
                          Abrir link
                        </a>
                      ) : (
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
                      )
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

