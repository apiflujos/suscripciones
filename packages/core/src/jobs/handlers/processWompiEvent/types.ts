/**
 * Shared types for the modular Wompi webhook processing pipeline.
 * FIX #4: Extracted from the monolithic 1569-line processWompiEventLogic.
 */

import type { PaymentAssociationReason } from "@prisma/client";
import type { classifyReference } from "../../../webhooks/wompi/classifyReference";

export type WompiCustomerData = {
  full_name?: string;
  name?: string;
  fullName?: string;
  email?: string;
  phone_number?: string;
  phoneNumber?: string;
};

export type WompiCustomer = {
  name?: string;
  phone_number?: string;
  phone?: string;
};

export type WompiPaymentLinkRef = {
  id?: string;
  permalink?: string;
  checkout_url?: string;
  checkoutUrl?: string;
};

export type WompiTransaction = {
  id?: string;
  reference?: string;
  payment_link_id?: string;
  paymentLinkId?: string;
  payment_link?: WompiPaymentLinkRef;
  paymentLink?: WompiPaymentLinkRef;
  status?: string;
  status_message?: string;
  statusMessage?: string;
  amount_in_cents?: number;
  amountInCents?: number;
  currency?: string;
  customer_email?: string;
  customerEmail?: string;
  customer_data?: WompiCustomerData;
  customer?: WompiCustomer;
  finalized_at?: string | number;
  finalizedAt?: string | number;
  created_at?: string | number;
  createdAt?: string | number;
  paid_at?: string | number;
  paidAt?: string | number;
};

export type WompiPayload = {
  data?: {
    transaction?: WompiTransaction;
    customer_email?: string;
    customerEmail?: string;
  };
  signature?: { checksum?: string };
  event?: string;
  timestamp?: string | number;
};

/** Step 1: Parsed fields from webhook payload */
export type ParsedWebhookFields = {
  reference: string | undefined;
  transactionId: string | undefined;
  paymentLinkId: string | undefined;
  status: string | undefined;
  amountInCents: number | undefined;
  currency: string | undefined;
  email: string | undefined;
  phone: string | undefined;
  name: string | undefined;
  referenceClassification: ReturnType<typeof classifyReference>;
};

/** Step 2: Found payment records */
export type PaymentLookupResult = {
  paymentByLink: Record<string, any> | null;
  paymentLinkRecord: { paymentId: string; subscriptionId: string } | null;
  paymentByTxId: Record<string, any> | null;
  paymentByReference: Record<string, any> | null;
  paymentMatched: Record<string, any> | null;
  matchReason: string | null;
};

/** Step 3: Association decision */
export type AssociationDecision = {
  subscriptionId: string;
  customerId?: string;
  score: number;
  reason: PaymentAssociationReason;
  criteria: Record<string, unknown>;
  cycleNumber?: number | null;
};

/** Step 4: Resolved subscription + customer context */
export type SubscriptionResolution = {
  subscriptionId: string;
  subscription: Record<string, any> | null;
  associationScore: number | null;
  associationCriteria: Record<string, unknown> | null;
  associationReasonFromScore: PaymentAssociationReason | null;
  associationCycleNumber: number | null;
  associationCycleId: string | null;
};

/** Step 5: Payment record result */
export type PaymentRecordResult = {
  id: string;
  tenantId: string;
  customerId: string;
  subscriptionId: string | null;
  status: string;
  paidAt: Date | null;
  failedAt: Date | null;
  wompiTransactionId: string | null;
  wompiPaymentLinkId: string | null;
  checkoutUrl: string | null;
  reference: string;
  amountInCents: number;
  currency: string;
  cycleNumber: number | null;
  subscriptionCycleKey: string | null;
  origin: string;
  associationReason: string;
  associatedBy: string;
  matchScore: number | null;
  matchCriteria: Record<string, unknown> | null;
  providerResponse: Record<string, unknown>;
};
