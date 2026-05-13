import { BillingTenantModalButton } from "./BillingTenantModalButton";
import { DeleteSubscriptionButton } from "./DeleteSubscriptionButton";
import { ManualChargeButton } from "./ManualChargeButton";
import { ManualMarkPaidButton } from "./ManualMarkPaidButton";
import { ManualUnmarkPaidButton } from "./ManualUnmarkPaidButton";
import { MergeDuplicateSubscriptionsButton } from "./MergeDuplicateSubscriptionsButton";
import { PaymentCyclesModal } from "./PaymentCyclesModal";
import { PaymentHistoryButton } from "./PaymentHistoryButton";
import { PaymentLinkModalButton } from "./PaymentLinkModalButton";
import { SubscriptionEditModal } from "./SubscriptionEditModal";
import { TokenizationLinkModalButton } from "./TokenizationLinkModalButton";
import { buildBillingStatusCards, fmtMoney, formatLongCivilDate, splitProductDisplay } from "./billingDisplayHelpers";
import type { BillingCardContext, BillingRow } from "./billingTypes";

type BillingCardProps = {
  row: BillingRow;
  context: BillingCardContext;
};

export function buildSubscriptionDetail(row: BillingRow, context: BillingCardContext) {
  const transientTokenUrl =
    context.state.checkoutCustomerId && context.state.checkoutCustomerId === row.customerId
      ? context.state.tokenUrl
      : "";
  const currentCollectionDueAt =
    row.currentCollectionDueAt instanceof Date
      ? row.currentCollectionDueAt.toISOString()
      : row.currentCollectionDueAt ?? null;

  return {
    ...row,
    currentCollectionDueAt,
    currentCheckoutUrl: context.helpers.resolveRowCheckoutUrl(row),
    currentTokenUrl: context.helpers.resolveRowTokenUrl(row, transientTokenUrl)
  };
}

export function BillingCard({ row, context }: BillingCardProps) {
  const isAutoDebit = row.mode === "AUTO_DEBIT";
  const rowCheckoutUrl = context.helpers.resolveRowCheckoutUrl(row);
  const sentForRow = context.state.central === "sent" && context.helpers.matchesTransientSubscription(row);
  const createdPaymentForRow = context.state.central === "created" && Boolean(rowCheckoutUrl);
  const sentTokenForRow = Boolean(sentForRow && isAutoDebit);
  const sentPaymentForRow = Boolean(sentForRow && rowCheckoutUrl);
  const chargedForRow = context.state.chargeStatus === "ok" && context.state.actionSubscriptionId === row.id;
  const chargeDateScheduledForRow = context.state.chargeDateScheduled && context.state.actionSubscriptionId === row.id;
  const tenantsUpdatedForRow = context.state.tenantsUpdated && context.state.actionSubscriptionId === row.id;
  const chargeDueAt = row.vencimientoAt ? new Date(row.vencimientoAt) : null;
  const isChargeDue = Boolean(chargeDueAt && !Number.isNaN(chargeDueAt.getTime()) && chargeDueAt.getTime() <= Date.now());
  const chargeDue = typeof row.chargeDue === "boolean" ? row.chargeDue : !row.collectionCyclePaid && isChargeDue;
  const isCanceled = row.status === "CANCELED";
  const isSuspended = row.status === "SUSPENDED";
  const isExpired = row.status === "EXPIRED";
  const isReactivatable = isCanceled || isExpired;
  const isInactive = isReactivatable || isSuspended;
  const alreadyPaidCurrentPeriod = Boolean(row.lastPaidInCurrentPeriod);
  const canManualUnmarkPaid = Boolean(row.canManualUnmarkPaid);
  const customerTokenized = Boolean(row.customerTokenized);
  const paymentLinkBlockedReason = context.helpers.getPaymentLinkBlockedReason(row);
  const tokenizationBlockedReason = context.helpers.getTokenizationBlockedReason(row);
  const paymentMethodHref = `/customers/${encodeURIComponent(String(row.customerId || ""))}/payment-method?returnTo=${encodeURIComponent(context.data.returnTo)}`;
  const showChargeButton = isAutoDebit && !isInactive;
  const showMarkPaidButton = !isInactive && !alreadyPaidCurrentPeriod;
  const showPaymentLinkButton = !isInactive && !isAutoDebit;
  const showTokenizationLink = isAutoDebit && !isInactive;
  const duplicateKey = context.helpers.resolveDuplicateKey(row);
  const duplicateCount = context.helpers.duplicateCountByKey.get(duplicateKey) || 1;
  const keepRowId = context.helpers.duplicateKeepByKey.get(duplicateKey)?.id || row.id;
  const productLabel = String(row.productName || row.planName || "Producto");
  const productInitials =
    String(productLabel || "Producto")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase())
      .join("") || "PR";
  const stateBadges = buildBillingStatusCards(row);
  const autoChargeEnabled = Boolean(row.autoChargeEnabled);
  const retryAutomationEnabled = Boolean(row.retryAutomationEnabled);
  const nextChargeLabel = formatLongCivilDate(row.vencimientoAt);
  const currentCollectionDueLabel = formatLongCivilDate(row.currentCollectionDueAt || row.vencimientoAt);
  const nextRetryLabel = row.nextRetryAt ? formatLongCivilDate(row.nextRetryAt) : "Sin intento programado";
  const currentCycleLabel =
    row.periodoInicioAt && row.periodoFinAt ? `${formatLongCivilDate(row.periodoInicioAt)} – ${formatLongCivilDate(row.periodoFinAt)}` : "—";
  const lastPaymentLabel =
    row.pagoAt && row.pagoMonto
      ? `${formatLongCivilDate(row.pagoAt)} · ${fmtMoney(row.pagoMonto, row.moneda)}`
      : row.pagoAt
        ? formatLongCivilDate(row.pagoAt)
        : "No registrado";
  const productDisplay = splitProductDisplay(productLabel);
  const totalLabel = fmtMoney(row.totalInCents ?? row.montoInCents, row.moneda);
  const baseLabel = fmtMoney(row.valorBaseInCents ?? row.montoInCents, row.moneda);
  const shippingLabel = row.currentShippingInCents > 0 ? fmtMoney(row.currentShippingInCents, row.moneda) : "Gratis";

  return (
    <div className="billing-card">
      <div className="billing-header">
        <div className="billing-header-main">
          <div className="billing-status-line billing-status-line-footer" role="group" aria-label="Estado y contexto de cobro">
            {stateBadges.map((badge, index) => (
              <div
                key={`${row.id}-header-badge-${index}-${badge.heading}-${badge.value}`}
                className={`billing-status-card ${badge.className}`}
                title={badge.title || `${badge.heading}: ${badge.value}`}
              >
                <span className="billing-status-card-label">{badge.heading}</span>
                <span className="billing-status-card-value">{badge.value}</span>
              </div>
            ))}
          </div>
          <div className="billing-sub billing-sub-strong billing-sub-header">{row.tenantName || "—"}</div>
        </div>
        <div className="billing-header-right">
          <div className="billing-header-actions">
            <BillingTenantModalButton
              triggerId={`tenant-modal-open-${row.id}`}
              triggerLabel={row.tenantName || "Sin canal"}
              triggerClassName="pill pill-sm pill-muted"
              subscriptionId={row.id}
              scopeTenantId={row.tenantId || ""}
              tenantIds={Array.isArray(row.tenantIds) ? row.tenantIds.map(String) : []}
              tenants={context.data.tenants}
              csrfToken={context.data.csrfToken}
              returnTo={context.data.returnTo}
              action={context.actions.updateSubscriptionTenants}
            />
            <SubscriptionEditModal
              subscriptionId={row.id}
              tenantId={row.tenantId}
              csrfToken={context.data.csrfToken}
              returnTo={context.data.returnTo}
              currentChargeAt={row.vencimientoAt}
              periodStartAt={row.periodoInicioAt}
              currentPlanId={row.productId || row.planId}
              currentPlanName={productLabel}
              currentPlanCurrency={row.moneda}
              currentShippingInCents={row.currentShippingInCents}
              currentRequiresShipping={row.currentRequiresShipping}
              planIntervalUnit={row.planIntervalUnit}
              planIntervalCount={row.planIntervalCount}
              plans={context.data.planOptions}
              changeSubscriptionPlan={context.actions.changeSubscriptionPlan}
              cycleStartDay={row.cycleStartDay}
              paymentDay={row.paymentDay}
              paymentTiming={row.paymentTiming}
              graceDays={row.graceDays}
              suspendDays={row.suspendDays}
              cancelDays={row.cancelDays}
              collectionMode={row.mode}
              updateSubscriptionBillingSettings={context.actions.updateSubscriptionBillingSettings}
              deleteSubscription={context.actions.deleteSubscription}
              globalConfig={{ graceDays: row.graceDays, suspendDays: row.suspendDays, cancelDays: row.cancelDays }}
              CyclesModal={PaymentCyclesModal}
            />
            <PaymentHistoryButton subscriptionId={row.id} tenantId={row.tenantId} />
            <PaymentCyclesModal
              subscriptionId={row.id}
              csrfToken={context.data.csrfToken}
              returnTo={context.data.returnTo}
              tenantId={row.tenantId}
            />
            <DeleteSubscriptionButton
              action={context.actions.deleteSubscription}
              csrfToken={context.data.csrfToken}
              subscriptionId={row.id}
              tenantId={row.tenantId}
              returnTo={context.data.returnTo}
            />
          </div>
        </div>
      </div>

      <div className="billing-card-body">
        <div className="billing-card-col billing-card-col-personal">
          <div className="billing-body-row">
            <span className="billing-body-label">Cliente</span>
            <div className="billing-personal-list">
              <div className="billing-body-value">{row.customerName}</div>
              {row.customerEmail ? <div className="billing-personal-meta">{row.customerEmail}</div> : null}
              {row.identificacion && row.identificacion !== "—" ? <div className="billing-personal-meta">ID {row.identificacion}</div> : null}
              {row.customerPhone ? <div className="billing-personal-meta">{row.customerPhone}</div> : null}
            </div>
          </div>
        </div>
        <div className="billing-card-col billing-card-col-product">
          <div className="billing-body-row">
            <span className="billing-body-label">Producto</span>
            <div className="billing-product-row billing-product-row-compact">
              <div className="product-thumb billing-product-thumb">
                {row.planImageUrl ? (
                  <img
                    src={row.planImageUrl}
                    alt={productLabel}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span className="billing-product-fallback">{productInitials}</span>
                )}
              </div>
              <div className="billing-product-meta">
                <strong className="billing-value billing-value-compact">{productDisplay.name}</strong>
                {productDisplay.sku ? <div className="billing-product-sku">SKU {productDisplay.sku}</div> : null}
              </div>
            </div>
          </div>
        </div>
        <div className="billing-card-col billing-card-col-right billing-card-col-payments">
          <div className="billing-body-row billing-body-row-keyval">
            <span className="billing-body-label">Cobro automático</span>
            <div className="billing-body-value">{isAutoDebit ? (autoChargeEnabled ? "Activo" : "Apagado") : "No aplica"}</div>
          </div>
          <div className="billing-body-row billing-body-row-keyval">
            <span className="billing-body-label">Vencimiento</span>
            <div className="billing-body-value">{currentCollectionDueLabel}</div>
          </div>
          <div className="billing-body-row billing-body-row-keyval">
            <span className="billing-body-label">Próx. intento</span>
            <div className="billing-body-value">
              {isAutoDebit ? (autoChargeEnabled && retryAutomationEnabled ? nextRetryLabel : "No programado") : "No aplica"}
            </div>
          </div>
          <div className="billing-body-row billing-body-row-keyval">
            <span className="billing-body-label">Próx. cobro</span>
            <div className="billing-body-value">{nextChargeLabel}</div>
          </div>
          <div className="billing-body-row billing-body-row-keyval">
            <span className="billing-body-label">Ciclo</span>
            <div className="billing-body-value">{currentCycleLabel}</div>
          </div>
          <div className="billing-body-row billing-body-row-keyval">
            <span className="billing-body-label">Último pago</span>
            <div className="billing-body-value">{lastPaymentLabel}</div>
          </div>
          <div className="billing-totals-panel billing-totals-panel-compact">
            <span className="billing-body-label billing-body-label-accent">Total</span>
            <div className="billing-totals-main">{totalLabel}</div>
            <div className="billing-totals-breakdown">
              <span className="billing-cost-chip">Base {baseLabel}</span>
              <span className="billing-cost-chip">Flete {shippingLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="billing-actions">
        <div className="billing-actions-left">
          {duplicateCount > 1 && keepRowId === row.id ? (
            <MergeDuplicateSubscriptionsButton
              action={context.actions.mergeDuplicateSubscriptions}
              csrfToken={context.data.csrfToken}
              customerId={row.customerId}
              productId={row.productId || undefined}
              planId={row.planId}
              keepSubscriptionId={keepRowId}
              tenantId={row.tenantId}
              returnTo={context.data.returnTo}
              duplicatesCount={duplicateCount}
            />
          ) : null}
        </div>
        <div className="billing-actions-right">
          {showChargeButton ? (
            <ManualChargeButton
              action={context.actions.chargeSubscriptionNow}
              csrfToken={context.data.csrfToken}
              subscriptionId={row.id}
              tenantId={row.tenantId}
              returnTo={context.data.returnTo}
              warnNotDue={!chargeDue}
              warnAlreadyPaid={alreadyPaidCurrentPeriod}
              manualChargeEnabled={row.manualChargeEnabled}
            />
          ) : null}
          {showMarkPaidButton ? (
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
          {showPaymentLinkButton ? (
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
              blockedReason={paymentLinkBlockedReason}
              action={context.actions.sendWhatsAppPaymentLink}
            />
          ) : null}
          {showTokenizationLink ? (
            <TokenizationLinkModalButton
              customerId={row.customerId}
              productId={row.productId || undefined}
              planId={row.planId}
              tenantId={row.tenantId}
              csrfToken={context.data.csrfToken}
              returnTo={context.data.returnTo}
              notificationTemplates={context.data.notificationsTemplates}
              notificationRules={context.data.notificationsRules}
              blockedReason={tokenizationBlockedReason}
              action={context.actions.sendWhatsAppTokenizationLink}
            />
          ) : null}
          {isAutoDebit && !isInactive ? (
            <a
              className="ghost btn-compact btn-blue contact-action-btn action-card"
              href={paymentMethodHref}
              title={customerTokenized ? "Actualizar tarjeta guardada" : "Guardar tarjeta para débito automático"}
            >
              {customerTokenized ? "Actualizar tarjeta" : "Guardar tarjeta"}
            </a>
          ) : null}
          {alreadyPaidCurrentPeriod && canManualUnmarkPaid ? (
            <ManualUnmarkPaidButton
              action={context.actions.unmarkSubscriptionPaidManual}
              csrfToken={context.data.csrfToken}
              subscriptionId={row.id}
              tenantId={row.tenantId}
              returnTo={context.data.returnTo}
            />
          ) : null}
          {row.status === "SUSPENDED" ? (
            <form action={context.actions.resumeSubscription}>
              <input type="hidden" name="csrf" value={context.data.csrfToken} />
              <input type="hidden" name="subscriptionId" value={row.id} />
              {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
              <button className="ghost btn-compact btn-green btn-noicon contact-action-btn action-token" type="submit" title="Reanudar suscripción">
                Reanudar
              </button>
            </form>
          ) : isReactivatable ? (
            <form action={context.actions.activateSubscription}>
              <input type="hidden" name="csrf" value={context.data.csrfToken} />
              <input type="hidden" name="subscriptionId" value={row.id} />
              {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
              <input type="hidden" name="returnTo" value={context.data.returnTo} />
              <button className="ghost btn-compact btn-green btn-noicon contact-action-btn action-token" type="submit" title={isExpired ? "Reactivar suscripción expirada" : "Reactivar suscripción"}>
                Reactivar
              </button>
            </form>
          ) : (
            <>
              <form hidden action={context.actions.cancelSubscription}>
                <input type="hidden" name="csrf" value={context.data.csrfToken} />
                <input type="hidden" name="subscriptionId" value={row.id} />
                {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
                <button className="ghost btn-compact btn-red btn-noicon contact-action-btn action-danger" type="submit" title="Cancelar suscripción">
                  Cancelar
                </button>
              </form>
              <form hidden action={context.actions.suspendSubscription}>
                <input type="hidden" name="csrf" value={context.data.csrfToken} />
                <input type="hidden" name="subscriptionId" value={row.id} />
                {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
                <button className="ghost btn-compact btn-amber btn-noicon contact-action-btn" type="submit" title="Suspender suscripción">
                  Suspender
                </button>
              </form>
            </>
          )}
        </div>
        {(sentTokenForRow || sentPaymentForRow || createdPaymentForRow || chargedForRow || chargeDateScheduledForRow) ? (
          <div className="field-hint billing-action-feedback">
            {sentTokenForRow ? <span>Link de tarjeta enviado.</span> : null}
            {sentPaymentForRow ? <span>Link de pago enviado.</span> : null}
            {createdPaymentForRow ? <span>Link de pago creado.</span> : null}
            {chargedForRow ? <span>Cobro manual en proceso.</span> : null}
            {chargeDateScheduledForRow ? <span>Fecha de pago actualizada.</span> : null}
            {!isAutoDebit && rowCheckoutUrl ? (
              <a
                className="ghost btn-compact btn-send btn-highlight"
                href={rowCheckoutUrl}
                target="_blank"
                rel="noreferrer"
                title="Abrir link de pago"
              >
                Abrir link
              </a>
            ) : null}
          </div>
        ) : null}
        {tenantsUpdatedForRow ? <div className="field-hint">Canales actualizados.</div> : null}
      </div>
    </div>
  );
}

