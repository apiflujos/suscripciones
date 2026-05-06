import { SubscriptionDetailModalWrapper } from "./SubscriptionDetailModalWrapper";
import { PaymentLinkModalButton } from "./PaymentLinkModalButton";
import { TokenizationLinkModalButton } from "./TokenizationLinkModalButton";
import { buildSubscriptionDetail } from "./BillingCard";
import { formatCivilDate } from "./civilDate";
import { getCollectionStatusLabel } from "./billingDisplayHelpers";
import type { BillingCardContext, BillingRow } from "./billingTypes";

type BillingViewListaProps = {
  rows: BillingRow[];
  context: BillingCardContext;
};

export function BillingViewLista({ rows, context }: BillingViewListaProps) {
  return (
    <div className="billing-list">
      <div className="billing-list-header">
        <span>Datos personales</span>
        <span>Producto</span>
        <span>Suscripción</span>
        <span>Fecha de corte</span>
        <span>Estado</span>
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
        const isCanceled = row.status === "CANCELED";
        const isSuspended = row.status === "SUSPENDED";
        const isExpired = row.status === "EXPIRED";
        const isInactive = isCanceled || isSuspended || isExpired;
        const contactHref = `/customers?${new URLSearchParams({
          tx: row.customerId,
          ...(row.tenantId ? { tenantId: row.tenantId } : {})
        }).toString()}`;
        const productHref = `/products?${new URLSearchParams({
          q: row.productName || row.planName || "",
          ...(row.tenantId ? { tenantId: row.tenantId } : {})
        }).toString()}`;

        return (
          <div className="billing-list-row" key={`list-${row.id}`}>
            <div className="billing-list-cell billing-list-person">
              <a className="billing-list-name" href={contactHref}>{row.customerName}</a>
              <div className="billing-list-sub">{row.customerEmail || "—"} · {row.identificacion || "—"}</div>
            </div>
            <div className="billing-list-cell billing-list-product">
              <a className="billing-list-link" href={productHref}>{row.productName || row.planName || "—"}</a>
            </div>
            <div className="billing-list-cell billing-list-product">
              <div className="billing-list-sub">{row.tipoTx || "—"} · {row.cada}</div>
            </div>
            <div className="billing-list-cell billing-list-cutoff">{formatCivilDate(row.vencimientoAt)}</div>
            <div className="billing-list-cell billing-list-status">
              <span
                className={`pill pill-sm ${paymentStatus === "Al día" ? "pill-ok" : paymentStatus === "En mora" ? "pill-bad" : "pill-warn"}`}
                title={`Cobro: ${paymentStatus} · Suscripción: ${row.estadoInfo.label}`}
              >
                {paymentStatus}
              </span>
            </div>
            <div className="billing-list-cell billing-list-more">
              <div className="billing-list-actions">
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
                />
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
                  (() => {
                    const rowTokenUrl = context.helpers.resolveRowTokenUrl(
                      row,
                      context.state.checkoutCustomerId && context.state.checkoutCustomerId === row.customerId
                        ? context.state.tokenUrl
                        : ""
                    );
                    return rowTokenUrl ? (
                      <a
                        className="ghost btn-compact btn-send btn-highlight"
                        href={rowTokenUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Abrir link de tokenización"
                      >
                        Abrir link
                      </a>
                    ) : (
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
                    );
                  })()
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
      {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
    </div>
  );
}
