/**
 * Step helpers: dates, status resolution, and payment source extraction.
 * FIX #4: Extracted from the monolithic processWompiEventLogic.
 */

import { PaymentStatus } from "@prisma/client";
import type { WompiPayload } from "./types";

/**
 * Extract paid_at timestamp from Wompi webhook payload.
 * Handles both seconds and milliseconds Unix timestamps.
 */
export function getPaidAtFromPayload(payload: WompiPayload): Date | null {
  const tx = payload?.data?.transaction;
  const raw =
    tx?.paid_at ||
    tx?.paidAt ||
    tx?.finalized_at ||
    tx?.finalizedAt ||
    tx?.created_at ||
    tx?.createdAt ||
    payload?.timestamp;
  if (!raw) return null;
  const rawNum = Number(raw);
  const normalizedRaw =
    Number.isFinite(rawNum) && rawNum > 0
      ? (rawNum < 1_000_000_000_000 ? rawNum * 1000 : rawNum)
      : raw;
  const dt = new Date(normalizedRaw as any);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Get the event timestamp from the provider's timestamp field.
 */
export function getProviderEventAt(providerTs: bigint | null | undefined): Date | null {
  if (providerTs == null) return null;
  const num = Number(providerTs);
  if (!Number.isFinite(num) || num <= 0) return null;
  const ms = num < 1_000_000_000_000 ? num * 1000 : num;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Extract payment source type from provider response (for Shopify detection).
 */
export function getPaymentSourceFromProviderResponse(resp: unknown): string {
  if (!resp || typeof resp !== "object") return "";
  const order = (resp as Record<string, unknown>).order;
  if (!order || typeof order !== "object") return "";
  return String((order as Record<string, unknown>).source || "").toUpperCase();
}

/**
 * Resolve the persisted payment status when merging prev + incoming.
 * Rules:
 * - APPROVED is terminal (never downgrade)
 * - If incoming is APPROVED, use it
 * - If prev is failed and incoming is PENDING, keep the failed status
 */
export function resolvePersistedPaymentStatus(
  prev: PaymentStatus | null,
  incoming: PaymentStatus | null
): PaymentStatus | null {
  if (!incoming) return prev;
  if (!prev) return incoming;
  if (prev === PaymentStatus.APPROVED) return PaymentStatus.APPROVED;
  if (incoming === PaymentStatus.APPROVED) return PaymentStatus.APPROVED;
  if (
    (prev === PaymentStatus.DECLINED || prev === PaymentStatus.ERROR || prev === PaymentStatus.VOIDED) &&
    incoming === PaymentStatus.PENDING
  ) {
    return prev;
  }
  return incoming;
}

/**
 * Convert Wompi status string to PaymentStatus enum.
 */
export function mapWompiStatusToPaymentStatus(status: string | undefined): PaymentStatus | null {
  const normalized = String(status || "").toUpperCase();
  switch (normalized) {
    case "APPROVED":
      return PaymentStatus.APPROVED;
    case "DECLINED":
      return PaymentStatus.DECLINED;
    case "ERROR":
      return PaymentStatus.ERROR;
    case "VOIDED":
      return PaymentStatus.VOIDED;
    case "PENDING":
    case "PROCESSING":
      return PaymentStatus.PENDING;
    default:
      return null;
  }
}

/**
 * Extract a human-readable failure message from the Wompi payload.
 */
export function extractFailureMessage(payload: WompiPayload): string | undefined {
  const tx = payload?.data?.transaction;
  const statusMessage = firstText(
    (tx as any)?.status_message,
    (tx as any)?.statusMessage,
    (tx as any)?.status_reason,
    (tx as any)?.statusReason
  );
  if (statusMessage) return statusMessage;
  const method = (tx as any)?.payment_method;
  const extra = method && typeof method === "object" ? (method as any).extra : null;
  const extraMsg = firstText(extra?.status_message, extra?.statusMessage, extra?.message, extra?.error);
  return extraMsg;
}

function firstText(...values: unknown[]): string {
  for (const v of values) {
    const txt = String(v || "").trim();
    if (txt) return txt;
  }
  return "";
}
