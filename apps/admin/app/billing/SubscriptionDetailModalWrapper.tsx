"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { SubscriptionDetailModal } from "./SubscriptionDetailModal";

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
  productId?: string | null;
  productName?: string | null;
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
  currentCollectionDueAt?: string | null;
  duplicateCount?: number;
  canManualCharge?: boolean;
  canManualMarkPaid?: boolean;
  canManualUnmarkPaid?: boolean;
  manualChargeEnabled?: boolean;
  manualMarkPaidEnabled?: boolean;
  chargeDue?: boolean;
  lastPaidInCurrentPeriod?: boolean;
  currentCheckoutUrl?: string | null;
  currentTokenUrl?: string | null;
};

export function SubscriptionDetailModalWrapper({
  subscription,
  csrfToken,
  returnTo,
  tenants,
  planOptions,
  notificationsTemplates,
  notificationsRules,
  chargeSubscriptionNow,
  markSubscriptionPaidManual,
  unmarkSubscriptionPaidManual,
  mergeDuplicateSubscriptions,
  sendWhatsAppPaymentLink,
  sendWhatsAppTokenizationLink,
  updateSubscriptionTenants,
  changeSubscriptionPlan,
  updateSubscriptionBillingSettings,
  deleteSubscription,
  suspendSubscription,
  cancelSubscription,
  resumeSubscription,
  activateSubscription,
  children,
  className
}: {
  subscription: SubscriptionDetail;
  csrfToken: string;
  returnTo: string;
  tenants: Array<{ id: string; name: string }>;
  planOptions: any[];
  notificationsTemplates?: any[];
  notificationsRules?: any[];
  chargeSubscriptionNow: (formData: FormData) => void | Promise<void>;
  markSubscriptionPaidManual: (formData: FormData) => void | Promise<void>;
  unmarkSubscriptionPaidManual: (formData: FormData) => void | Promise<void>;
  mergeDuplicateSubscriptions: (formData: FormData) => void | Promise<void>;
  sendWhatsAppPaymentLink: (formData: FormData) => void | Promise<void>;
  sendWhatsAppTokenizationLink: (formData: FormData) => void | Promise<void>;
  updateSubscriptionTenants: (formData: FormData) => void | Promise<void>;
  changeSubscriptionPlan: (formData: FormData) => void | Promise<void>;
  updateSubscriptionBillingSettings: (formData: FormData) => void | Promise<void>;
  deleteSubscription: (formData: FormData) => void | Promise<void>;
  suspendSubscription: (formData: FormData) => void | Promise<void>;
  cancelSubscription: (formData: FormData) => void | Promise<void>;
  resumeSubscription: (formData: FormData) => void | Promise<void>;
  activateSubscription: (formData: FormData) => void | Promise<void>;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return children ? (
      <button
        className={className}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ver detalles"
        title="Ver detalles"
      >
        {children}
      </button>
    ) : (
      <button
        className="ghost btn-compact btn-icon-only btn-view"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ver detalles"
        title="Ver detalles"
      />
    );
  }

  return (
    <>
      {children ? (
        <button
          className={className}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ver detalles"
          title="Ver detalles"
        >
          {children}
        </button>
      ) : (
        <button
          className="ghost btn-compact btn-icon-only btn-view"
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ver detalles"
          title="Ver detalles"
        />
      )}
      {open && (
        <SubscriptionDetailModal
          key={subscription.id}
          subscription={subscription}
          csrfToken={csrfToken}
          returnTo={returnTo}
          tenants={tenants}
          planOptions={planOptions}
          notificationsTemplates={notificationsTemplates}
          notificationsRules={notificationsRules}
          onClose={() => setOpen(false)}
          chargeSubscriptionNow={chargeSubscriptionNow}
          markSubscriptionPaidManual={markSubscriptionPaidManual}
          unmarkSubscriptionPaidManual={unmarkSubscriptionPaidManual}
          mergeDuplicateSubscriptions={mergeDuplicateSubscriptions}
          sendWhatsAppPaymentLink={sendWhatsAppPaymentLink}
          sendWhatsAppTokenizationLink={sendWhatsAppTokenizationLink}
          updateSubscriptionTenants={updateSubscriptionTenants}
          changeSubscriptionPlan={changeSubscriptionPlan}
          updateSubscriptionBillingSettings={updateSubscriptionBillingSettings}
          deleteSubscription={deleteSubscription}
          suspendSubscription={suspendSubscription}
          cancelSubscription={cancelSubscription}
          resumeSubscription={resumeSubscription}
          activateSubscription={activateSubscription}
        />
      )}
    </>
  );
}
