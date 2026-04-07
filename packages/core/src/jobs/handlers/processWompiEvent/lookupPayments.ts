/**
 * Step 2: Look up existing payment records by multiple strategies.
 * FIX #4: Extracted from the monolithic processWompiEventLogic.
 */

import type { PaymentAssociationReason } from "@prisma/client";
import type { prisma } from "../../../db/prisma";
import { classifyReference } from "../../../webhooks/wompi/classifyReference";
import type { PaymentLookupResult } from "./types";

/**
 * Search for an existing payment using all available identifiers.
 * Priority: payment_link_id > transaction_id > reference.
 */
export async function lookupPayments(args: {
  db: typeof prisma;
  tenantId: string | null;
  reference: string | undefined;
  transactionId: string | undefined;
  paymentLinkId: string | undefined;
}): Promise<PaymentLookupResult> {
  const { db, tenantId, reference, transactionId, paymentLinkId } = args;

  // 1. By payment_link_id
  let paymentByLink = paymentLinkId
    ? await db.payment.findUnique({ where: { wompiPaymentLinkId: paymentLinkId } })
    : null;

  const paymentLinkRecord = paymentLinkId
    ? await db.paymentLink.findUnique({
        where: { wompiPaymentLinkId: paymentLinkId },
        select: { paymentId: true, subscriptionId: true }
      })
    : null;

  if (!paymentByLink && paymentLinkRecord?.paymentId) {
    paymentByLink = await db.payment.findUnique({ where: { id: paymentLinkRecord.paymentId } });
  }

  // 2. By transaction_id
  const paymentByTxId = transactionId
    ? await db.payment.findUnique({ where: { wompiTransactionId: transactionId } })
    : null;

  // 3. By reference (scoped to tenant first, then global)
  let paymentByReference = reference
    ? await db.payment.findFirst({
        where: {
          reference,
          ...(tenantId ? { tenantId } : {})
        },
        orderBy: { createdAt: "desc" }
      })
    : null;

  if (!paymentByReference && reference && tenantId) {
    paymentByReference = await db.payment.findFirst({
      where: { reference },
      orderBy: { createdAt: "desc" }
    });
  }

  const paymentMatched = paymentByLink ?? paymentByTxId ?? paymentByReference ?? null;

  // Determine match reason for audit trail
  const matchReason =
    paymentByLink || paymentLinkRecord?.paymentId
      ? "LINK_MATCH"
      : paymentByTxId
        ? "TX_MATCH"
        : paymentByReference
          ? "REF_MATCH"
          : null;

  return {
    paymentByLink,
    paymentLinkRecord,
    paymentByTxId,
    paymentByReference,
    paymentMatched,
    matchReason
  };
}

export function resolveMatchReason(
  paymentByLink: Record<string, any> | null,
  paymentLinkRecord: { paymentId: string; subscriptionId: string } | null,
  paymentByTxId: Record<string, any> | null,
  paymentByReference: Record<string, any> | null,
  referenceClassification: ReturnType<typeof classifyReference>
): string | null {
  return paymentByLink || paymentLinkRecord?.paymentId
    ? "LINK_MATCH"
    : paymentByTxId
      ? "TX_MATCH"
      : paymentByReference
        ? "REF_MATCH"
        : referenceClassification.kind === "subscription" && referenceClassification.subscriptionId
          ? "SUB_REF"
          : null;
}
