"use client";

import { useState } from "react";
import { LocalDateTime } from "../ui/LocalDateTime";
import { HelpTip } from "../ui/HelpTip";
import { SubscriptionEditModal } from "./SubscriptionEditModal";
import { PaymentHistoryButton } from "./PaymentHistoryButton";
import { PaymentCyclesModal } from "./PaymentCyclesModal";
import { DeleteSubscriptionButton } from "./DeleteSubscriptionButton";
import { ManualChargeButton } from "./ManualChargeButton";
import { ManualMarkPaidButton } from "./ManualMarkPaidButton";
import { ManualUnmarkPaidButton } from "./ManualUnmarkPaidButton";
import { MergeDuplicateSubscriptionsButton } from "./MergeDuplicateSubscriptionsButton";
import { PaymentLinkModalButton } from "./PaymentLinkModalButton";
import { TokenizationLinkModalButton } from "./TokenizationLinkModalButton";

type SubscriptionDetail = {
  id: string;
  tenantId?: string | null;
  tenantName?: string;
  tenantIds?: string[];
  customerId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  identificacion?: string | null;
  customerTokenized: boolean;
  planId: string;
  planName: string;
  planImageUrl?: string | null;
  moneda: string;
  totalInCents: number;
  valorBaseInCents: number;
  currentShippingInCents: number;
  planIntervalUnit: string;
  planIntervalCount: number;
  cada: string;
  vencimientoAt: string | null;
  periodoInicioAt: string | null;
  periodoFinAt?: string | null;
  tipoTx?: string | null;
  mode?: string | null;
  cycleStartDay: number;
  status: string;
  inGrace?: boolean;
  inArrears?: boolean;
  daysLate?: number;
  paymentDay: number;
  paymentTiming: string;
  graceDays: number;
  suspendDays?: number;
  cancelDays?: number;
  duplicateCount?: number;
  canManualCharge?: boolean;
  canManualMarkPaid?: boolean;
  manualChargeEnabled?: boolean;
  manualMarkPaidEnabled?: boolean;
  chargeDue?: boolean;
  lastPaidInCurrentPeriod?: boolean;
};

export function SubscriptionDetailModal({
  subscription,
  csrfToken,
  returnTo,
  tenants,
  planOptions,
  notificationsTemplates,
  notificationsRules,
  onClose,
  chargeSubscriptionNow,
  markSubscriptionPaidManual,
  unmarkSubscriptionPaidManual,
  mergeDuplicateSubscriptions,
  sendCentralComPaymentLink,
  sendCentralComTokenizationLink,
  updateSubscriptionTenants,
  changeSubscriptionPlan,
  updateSubscriptionBillingSettings,
  deleteSubscription,
  suspendSubscription,
  cancelSubscription,
  resumeSubscription,
  activateSubscription
}: {
  subscription: SubscriptionDetail;
  csrfToken: string;
  returnTo: string;
  tenants: Array<{ id: string; name: string }>;
  planOptions: any[];
  notificationsTemplates?: any[];
  notificationsRules?: any[];
  onClose: () => void;
  chargeSubscriptionNow: (formData: FormData) => void | Promise<void>;
  markSubscriptionPaidManual: (formData: FormData) => void | Promise<void>;
  unmarkSubscriptionPaidManual: (formData: FormData) => void | Promise<void>;
  mergeDuplicateSubscriptions: (formData: FormData) => void | Promise<void>;
  sendCentralComPaymentLink: (formData: FormData) => void | Promise<void>;
  sendCentralComTokenizationLink: (formData: FormData) => void | Promise<void>;
  updateSubscriptionTenants: (formData: FormData) => void | Promise<void>;
  changeSubscriptionPlan: (formData: FormData) => void | Promise<void>;
  updateSubscriptionBillingSettings: (formData: FormData) => void | Promise<void>;
  deleteSubscription: (formData: FormData) => void | Promise<void>;
  suspendSubscription: (formData: FormData) => void | Promise<void>;
  cancelSubscription: (formData: FormData) => void | Promise<void>;
  resumeSubscription: (formData: FormData) => void | Promise<void>;
  activateSubscription: (formData: FormData) => void | Promise<void>;
}) {
  const tenantId = subscription.tenantId ?? undefined;
  const [editModalOpen, setEditModalOpen] = useState(false);

  const fmtMoney = (cents: number, currency: string) => {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
  };

  const productInitials = String(subscription.planName || "PR")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join("") || "PR";

  const estadoSimple = {
    label: subscription.status === "ACTIVE" ? "Activa" : subscription.status === "PAST_DUE" ? "En mora" : "Inactiva",
    class: subscription.status === "ACTIVE" ? "pill-ok" : subscription.status === "PAST_DUE" ? "pill-bad" : "pill-muted"
  };

  const modeValue = String(subscription.mode || "").trim().toUpperCase();
  const tipoLabel = String(subscription.tipoTx || "").toLowerCase();
  const alreadyPaidCurrentPeriod = Boolean(subscription.lastPaidInCurrentPeriod);
  const isAutoDebit = modeValue === "AUTO_DEBIT" || tipoLabel.includes("débito") || tipoLabel.includes("debito");
  const showChargeButton = isAutoDebit && !subscription.status.includes("CANCELED");
  const showMarkPaidButton = !subscription.status.includes("CANCELED") && !alreadyPaidCurrentPeriod;
  const showResume = subscription.status === "SUSPENDED";
  const showActivate = subscription.status === "CANCELED";
  const showCancelSuspend = !showResume && !showActivate;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel subscription-detail-modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(1000px, 96vw)", maxHeight: "90vh", overflow: "auto" }}>
          {/* HEADER */}
          <div className="panel-header" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <strong>Detalles de suscripción</strong>
              <span className={`pill pill-sm ${estadoSimple.class}`}>{estadoSimple.label}</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                className="ghost btn-compact btn-icon-only btn-edit"
                type="button"
                onClick={() => setEditModalOpen(true)}
                title="Editar suscripción"
                aria-label="Editar"
              />
              <PaymentHistoryButton subscriptionId={subscription.id} tenantId={tenantId} />
              <PaymentCyclesModal
                subscriptionId={subscription.id}
                csrfToken={csrfToken}
                returnTo={returnTo}
                tenantId={tenantId}
              />
              <DeleteSubscriptionButton
                action={deleteSubscription}
                csrfToken={csrfToken}
                subscriptionId={subscription.id}
                tenantId={tenantId}
                returnTo={returnTo}
              />
              <button
                className="ghost modal-close"
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
          </div>

          {/* BODY */}
          <div className="modal-body" style={{ display: "grid", gap: 16 }}>
            {/* Información principal */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Contacto */}
              <div className="card cardPad" style={{ padding: 12 }}>
                <div className="billing-section-title" style={{ marginBottom: 8 }}>Contacto</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <div className="field-hint">Nombre</div>
                    <div className="contact-value">{subscription.customerName}</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <div className="field-hint">Email</div>
                      <div className="contact-value">{subscription.customerEmail || "—"}</div>
                    </div>
                    <div>
                      <div className="field-hint">Teléfono</div>
                      <div className="contact-value">{subscription.customerPhone || "—"}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <div className="field-hint">Identificación</div>
                      <div className="contact-value">{subscription.identificacion || "—"}</div>
                    </div>
                    <div>
                      <div className="field-hint">Canal</div>
                      <div className="contact-value">{subscription.tenantName || "—"}</div>
                    </div>
                  </div>
                  <div>
                    <div className="field-hint">Tokenización</div>
                    <div>
                      {subscription.customerTokenized ? (
                        <span className="pill pill-sm pill-ok">Tarjeta guardada</span>
                      ) : (
                        <span className="pill pill-sm pill-warn">Sin tarjeta</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Producto */}
              <div className="card cardPad" style={{ padding: 12 }}>
                <div className="billing-section-title" style={{ marginBottom: 8 }}>Producto</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div className="billing-product-thumb" style={{ width: 48, height: 48, minWidth: 48 }}>
                    {subscription.planImageUrl ? (
                      <img src={subscription.planImageUrl} alt={subscription.planName} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
                    ) : (
                      <span className="billing-product-fallback" style={{ fontSize: 14 }}>{productInitials}</span>
                    )}
                  </div>
                  <div>
                    <div className="billing-value" style={{ fontSize: 14 }}>{subscription.planName}</div>
                    <div className="field-hint" style={{ marginTop: 4 }}>
                    <span className={`pill pill-sm ${String(subscription.tipoTx || "").includes("Débito") ? "pill-ok" : "pill-muted"}`}>
                      {subscription.tipoTx || "—"}
                    </span>
                  </div>
                </div>
                </div>
              </div>
            </div>

            {/* Fechas y costos */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Fecha de cobro */}
              <div className="card cardPad" style={{ padding: 12 }}>
                <div className="billing-section-title" style={{ marginBottom: 8 }}>
                  Fecha de cobro
                  <HelpTip text="Fecha cuando se realiza el cobro de la suscripción." />
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <div className="field-hint">Próximo cobro</div>
                    <div className="contact-value">
                      <LocalDateTime value={subscription.vencimientoAt} variant="short" />
                    </div>
                  </div>
                  {subscription.periodoInicioAt && subscription.periodoFinAt ? (
                    <div>
                      <div className="field-hint">Ciclo actual</div>
                      <div className="contact-value">
                        {new Date(subscription.periodoInicioAt).toLocaleDateString("es-CO")} → {new Date(subscription.periodoFinAt).toLocaleDateString("es-CO")}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <div className="field-hint">Inicio de ciclo</div>
                    <div className="contact-value">Día {subscription.cycleStartDay}</div>
                  </div>
                  <div>
                    <div className="field-hint">Día de pago</div>
                    <div className="contact-value">Día {subscription.paymentDay}</div>
                  </div>
                </div>
              </div>

              {/* Totales */}
              <div className="card cardPad" style={{ padding: 12 }}>
                <div className="billing-section-title" style={{ marginBottom: 8 }}>
                  Totales
                  <HelpTip text="Incluye base + flete según configuración del plan." />
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <div className="field-hint">Total</div>
                    <div className="billing-value" style={{ fontSize: 18, color: "var(--primary)" }}>
                      {fmtMoney(subscription.totalInCents, subscription.moneda)}
                    </div>
                    <div className="field-hint">{subscription.cada}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="billing-cost-chip">Base {fmtMoney(subscription.valorBaseInCents, subscription.moneda)}</span>
                    {subscription.currentShippingInCents > 0 ? (
                      <span className="billing-cost-chip">Flete {fmtMoney(subscription.currentShippingInCents, subscription.moneda)}</span>
                    ) : (
                      <span className="billing-cost-chip">Flete Gratis</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Configuración */}
            <div className="card cardPad" style={{ padding: 12 }}>
              <div className="billing-section-title" style={{ marginBottom: 8 }}>Configuración</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <div>
                  <div className="field-hint">Días de gracia</div>
                  <div className="contact-value">{subscription.graceDays} días</div>
                </div>
                <div>
                  <div className="field-hint">Suspender después de</div>
                  <div className="contact-value">{subscription.suspendDays || 15} días</div>
                </div>
                <div>
                  <div className="field-hint">Cancelar después de</div>
                  <div className="contact-value">{subscription.cancelDays || 30} días</div>
                </div>
                <div>
                  <div className="field-hint">Tipo de cobro</div>
                  <div className="contact-value">
                    {String(subscription.paymentTiming || "").toUpperCase() === "ANTICIPADO" ? "Adelantado" : "En curso"}
                  </div>
                </div>
              </div>
            </div>

            {/* Acciones */}
            <div className="card cardPad" style={{ padding: 12 }}>
              <div className="billing-section-title" style={{ marginBottom: 8 }}>Acciones</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {subscription.duplicateCount && subscription.duplicateCount > 1 ? (
                  <MergeDuplicateSubscriptionsButton
                    action={mergeDuplicateSubscriptions}
                    csrfToken={csrfToken}
                    customerId={subscription.customerId}
                    planId={subscription.planId}
                    keepSubscriptionId={subscription.id}
                    tenantId={tenantId}
                    returnTo={returnTo}
                    duplicatesCount={subscription.duplicateCount}
                  />
                ) : null}
                {showChargeButton ? (
                  <ManualChargeButton
                    action={chargeSubscriptionNow}
                    csrfToken={csrfToken}
                    subscriptionId={subscription.id}
                    tenantId={tenantId}
                    returnTo={returnTo}
                    warnNotDue={!subscription.chargeDue}
                    warnAlreadyPaid={alreadyPaidCurrentPeriod}
                    manualChargeEnabled={subscription.manualChargeEnabled}
                  />
                ) : null}
                {showMarkPaidButton ? (
                  <ManualMarkPaidButton
                    action={markSubscriptionPaidManual}
                    csrfToken={csrfToken}
                    subscriptionId={subscription.id}
                    tenantId={tenantId}
                    returnTo={returnTo}
                    warnAlreadyPaid={alreadyPaidCurrentPeriod}
                    manualMarkPaidEnabled={subscription.manualMarkPaidEnabled}
                  />
                ) : null}
                {alreadyPaidCurrentPeriod ? (
                  <ManualUnmarkPaidButton
                    action={unmarkSubscriptionPaidManual}
                    csrfToken={csrfToken}
                    subscriptionId={subscription.id}
                    tenantId={tenantId}
                    returnTo={returnTo}
                  />
                ) : null}
                {showResume ? (
                  <form action={resumeSubscription}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="subscriptionId" value={subscription.id} />
                    {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                    <button className="ghost btn-compact btn-green" type="submit" title="Reanudar suscripción">
                      Reanudar
                    </button>
                  </form>
                ) : null}
                {showActivate ? (
                  <form action={activateSubscription}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="subscriptionId" value={subscription.id} />
                    {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                    <button className="ghost btn-compact btn-green" type="submit" title="Activar suscripción">
                      Activar
                    </button>
                  </form>
                ) : null}
                {showCancelSuspend ? (
                  <>
                    <form action={cancelSubscription}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="subscriptionId" value={subscription.id} />
                      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                      <button className="ghost btn-compact btn-red" type="submit" title="Cancelar suscripción">
                        Cancelar
                      </button>
                    </form>
                    <form action={suspendSubscription}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="subscriptionId" value={subscription.id} />
                      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                      <button className="ghost btn-compact btn-amber" type="submit" title="Suspender suscripción">
                        Suspender
                      </button>
                    </form>
                  </>
                ) : null}
              </div>
            </div>

            <div className="module-footer">
              {!isAutoDebit ? (
                <PaymentLinkModalButton
                  subscriptionId={subscription.id}
                  customerId={subscription.customerId}
                  tenantId={tenantId}
                  csrfToken={csrfToken}
                  returnTo={returnTo}
                  defaultAmountPesos={Math.trunc(subscription.totalInCents / 100)}
                  notificationTemplates={notificationsTemplates}
                  notificationRules={notificationsRules}
                  action={sendCentralComPaymentLink}
                />
              ) : null}
              {isAutoDebit ? (
                <TokenizationLinkModalButton
                  customerId={subscription.customerId}
                  planId={subscription.planId}
                  tenantId={tenantId}
                  csrfToken={csrfToken}
                  returnTo={returnTo}
                  notificationTemplates={notificationsTemplates}
                  notificationRules={notificationsRules}
                  action={sendCentralComTokenizationLink}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Editar (anidado) */}
      {editModalOpen && (
        <SubscriptionEditModal
          subscriptionId={subscription.id}
          tenantId={tenantId}
          csrfToken={csrfToken}
          returnTo={returnTo}
          currentChargeAt={subscription.vencimientoAt}
          periodStartAt={subscription.periodoInicioAt}
          currentPlanId={subscription.planId}
          currentPlanName={subscription.planName}
          currentPlanCurrency={subscription.moneda}
          currentShippingInCents={subscription.currentShippingInCents}
          currentRequiresShipping={subscription.currentShippingInCents > 0}
          planIntervalUnit={subscription.planIntervalUnit}
          planIntervalCount={subscription.planIntervalCount}
          plans={planOptions}
          changeSubscriptionPlan={changeSubscriptionPlan}
          cycleStartDay={subscription.cycleStartDay}
          paymentDay={subscription.paymentDay}
          paymentTiming={subscription.paymentTiming}
          graceDays={subscription.graceDays}
          suspendDays={subscription.suspendDays || 15}
          cancelDays={subscription.cancelDays || 30}
          updateSubscriptionBillingSettings={updateSubscriptionBillingSettings}
          deleteSubscription={deleteSubscription}
          globalConfig={{ graceDays: 5, suspendDays: 15, cancelDays: 30 }}
        />
      )}
    </>
  );
}
