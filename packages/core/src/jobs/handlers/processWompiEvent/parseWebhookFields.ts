/**
 * Step 1: Parse & extract fields from Wompi webhook payload.
 * FIX #4: Extracted from the monolithic processWompiEventLogic.
 */

import { classifyReference } from "../../../webhooks/wompi/classifyReference";
import type { WompiPayload, WompiTransaction } from "./types";

export function getTransactionFromPayload(payload: WompiPayload): WompiTransaction | null {
  const tx = payload?.data?.transaction;
  return tx && typeof tx === "object" ? tx : null;
}

function normalizeReference(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  return cleaned || undefined;
}

function extractPaymentLinkId(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) {
      const parts = trimmed.split("/").filter(Boolean);
      return parts[parts.length - 1] || undefined;
    }
    return trimmed;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const direct = normalizeReference(obj.id);
    if (direct) return direct;
    const permalink = extractPaymentLinkId(obj.permalink);
    if (permalink) return permalink;
    const checkout = extractPaymentLinkId(obj.checkout_url ?? obj.checkoutUrl);
    if (checkout) return checkout;
  }
  return undefined;
}

export function getPaymentLinkIdFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  return (
    normalizeReference(tx?.payment_link_id) ??
    normalizeReference(tx?.paymentLinkId) ??
    extractPaymentLinkId(tx?.payment_link) ??
    extractPaymentLinkId(tx?.paymentLink) ??
    extractPaymentLinkId((payload?.data as any)?.payment_link) ??
    extractPaymentLinkId((payload?.data as any)?.paymentLink)
  );
}

export function getCustomerEmailFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const email =
    tx?.customer_email ||
    tx?.customerEmail ||
    payload?.data?.customer_email ||
    payload?.data?.customerEmail ||
    tx?.customer_data?.email;
  const trimmed = String(email || "").trim().toLowerCase();
  return trimmed || undefined;
}

export function getCustomerNameFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const name = tx?.customer_data?.full_name || tx?.customer_data?.name || tx?.customer_data?.fullName || tx?.customer?.name;
  const trimmed = String(name || "").trim();
  return trimmed || undefined;
}

export function getCustomerPhoneFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const phone = tx?.customer_data?.phone_number || tx?.customer_data?.phoneNumber || tx?.customer?.phone_number || tx?.customer?.phone;
  const trimmed = String(phone || "").trim();
  return trimmed || undefined;
}

export function isInternalReference(value: string | undefined): boolean {
  const ref = String(value || "").trim().toUpperCase();
  if (!ref) return false;
  return ref.startsWith("SUB_") || ref.startsWith("ORDER_") || ref.startsWith("WOMPI_") || ref.startsWith("TEST_");
}

/**
 * Extract all relevant fields from a webhook event in one pass.
 */
export function parseWebhookFields(payload: WompiPayload) {
  const tx = getTransactionFromPayload(payload);
  const reference = normalizeReference(tx?.reference);
  const transactionId = normalizeReference(tx?.id);
  const paymentLinkId = getPaymentLinkIdFromPayload(payload);
  const status = tx?.status;
  const amountInCents = tx?.amount_in_cents ?? tx?.amountInCents;
  const currency = tx?.currency;
  const email = getCustomerEmailFromPayload(payload);
  const phone = getCustomerPhoneFromPayload(payload);
  const name = getCustomerNameFromPayload(payload);
  const referenceClassification = classifyReference(reference);

  return {
    reference,
    transactionId,
    paymentLinkId,
    status,
    amountInCents,
    currency,
    email,
    phone,
    name,
    referenceClassification
  };
}
