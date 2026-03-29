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
  planId: string;
  planName: string;
  planImageUrl?: string | null;
  moneda: string;
  totalInCents: number;
  valorBaseInCents: number;
  currentShippingInCents: number;
  cada: string;
  vencimientoAt: string | null;
  periodoInicioAt: string | null;
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
  chargeDue?: boolean;
  lastPaidInCurrentPeriod?: boolean;
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
  sendCentralComPaymentLink,
  sendCentralComTokenizationLink,
  updateSubscriptionTenants,
  changeSubscriptionPlan,
  updateSubscriptionBillingSettings,
  deleteSubscription,
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
  sendCentralComPaymentLink: (formData: FormData) => void | Promise<void>;
  sendCentralComTokenizationLink: (formData: FormData) => void | Promise<void>;
  updateSubscriptionTenants: (formData: FormData) => void | Promise<void>;
  changeSubscriptionPlan: (formData: FormData) => void | Promise<void>;
  updateSubscriptionBillingSettings: (formData: FormData) => void | Promise<void>;
  deleteSubscription: (formData: FormData) => void | Promise<void>;
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
        className="ghost btn-compact btn-view"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ver detalles"
        title="Ver detalles"
      >
        Ver
      </button>
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
          className="ghost btn-compact btn-view"
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ver detalles"
          title="Ver detalles"
        >
          Ver
        </button>
      )}
      {open && (
        <SubscriptionDetailModal
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
          sendCentralComPaymentLink={sendCentralComPaymentLink}
          sendCentralComTokenizationLink={sendCentralComTokenizationLink}
          updateSubscriptionTenants={updateSubscriptionTenants}
          changeSubscriptionPlan={changeSubscriptionPlan}
          updateSubscriptionBillingSettings={updateSubscriptionBillingSettings}
          deleteSubscription={deleteSubscription}
        />
      )}
    </>
  );
}
