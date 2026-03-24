import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { getShopifyForward, getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiPublicKey } from "../services/runtimeConfig";
import { RetryJobType, WebhookProvider, WebhookProcessStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { processWompiEventLogic } from "../jobs/handlers/processWompiEvent";
import { getDefaultTenantId } from "./tenantContext";

const FINAL_WOMPI_STATUSES = new Set(["APPROVED", "DECLINED", "VOIDED", "ERROR"]);

function normalizeStatus(raw?: string | null) {
  return String(raw || "").trim().toUpperCase();
}

function extractWompiTransactionFromRaw(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const direct = root.data;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  const alt = (root as any).transaction;
  if (alt && typeof alt === "object" && !Array.isArray(alt)) {
    return alt as Record<string, unknown>;
  }
  const nested = (root as any).data?.transaction;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return null;
}

export async function reconcileWompiTransaction(args: {
  wompiTransactionId: string;
  tenantId?: string | null;
  processNow?: boolean;
  checksumPrefix?: string;
}) {
  const txId = String(args.wompiTransactionId || "").trim();
  if (!txId) {
    return { ok: false, reason: "missing_transaction_id" as const };
  }

  const requestedTenantId = String(args.tenantId || "").trim();
  const tenantId = requestedTenantId || String((await getDefaultTenantId()) || "").trim();
  if (!tenantId) {
    return { ok: false, reason: "missing_tenant" as const };
  }

  const publicKey = await getWompiPublicKey();
  if (!publicKey) {
    return { ok: false, reason: "wompi_public_key_not_configured" as const };
  }
  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey: "unused", checkoutLinkBaseUrl });
  let tx: Awaited<ReturnType<typeof wompi.getTransaction>>;
  try {
    tx = await wompi.getTransaction(txId, publicKey);
  } catch (err) {
    console.error('[WompiReconcile] Error fetching transaction', err);
    return { ok: false, reason: "wompi_api_unavailable" as const };
  }
  const status = normalizeStatus(tx.status);
  if (!FINAL_WOMPI_STATUSES.has(status)) {
    return { ok: false, reason: "status_not_final" as const, status };
  }

  const rawTx = extractWompiTransactionFromRaw(tx.raw);
  const payload = {
    event: "transaction.updated",
    data: {
      transaction: {
        // Prefer the raw Wompi shape so we preserve fields like `status_message`.
        // We still override core identifiers to guarantee normalization.
        ...(rawTx || {}),
        id: tx.id,
        status: tx.status,
        reference: tx.reference,
        amount_in_cents: tx.amountInCents,
        currency: tx.currency,
        payment_link_id: tx.paymentLinkId,
        customer_email: tx.customerEmail
      }
    }
  };

  const checksumPrefix = String(args.checksumPrefix || "reconcile").trim() || "reconcile";
  const event = await prisma.webhookEvent.create({
    data: {
      tenantId,
      provider: WebhookProvider.WOMPI,
      checksum: `${checksumPrefix}:${tx.id}:${randomUUID()}`,
      eventName: "transaction.updated",
      payload: payload as any,
      processStatus: WebhookProcessStatus.RECEIVED,
      receivedAt: new Date()
    }
  });

  const processNow = args.processNow !== false;
  const shopify = await getShopifyForward().catch(() => ({} as any));
  if (processNow) {
    await processWompiEventLogic(event.id, prisma).catch(async () => {
      await prisma.retryJob
        .create({
          data: {
            type: RetryJobType.PROCESS_WOMPI_EVENT,
            payload: { webhookEventId: event.id }
          }
        })
        .catch(() => {});
    });
  } else {
    await prisma.retryJob
      .create({
        data: {
          type: RetryJobType.PROCESS_WOMPI_EVENT,
          payload: { webhookEventId: event.id }
        }
      })
      .catch(() => {});
  }

  if (shopify?.url) {
    await prisma.retryJob
      .create({
        data: {
          type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
          payload: { webhookEventId: event.id },
          maxAttempts: 3
        }
      })
      .catch(() => {});
  }

  return { ok: true, webhookEventId: event.id, status: tx.status, reference: tx.reference };
}

function parseDateLike(input: unknown) {
  if (!input) return 0;
  const dt = new Date(String(input));
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export async function reconcileWompiByReference(args: {
  reference: string;
  tenantId?: string | null;
  paymentLinkId?: string | null;
  amountInCents?: number | null;
  currency?: string | null;
  processNow?: boolean;
  checksumPrefix?: string;
}) {
  const reference = String(args.reference || "").trim();
  if (!reference) return { ok: false, reason: "missing_reference" as const };
  const requestedTenantId = String(args.tenantId || "").trim();
  const tenantId = requestedTenantId || String((await getDefaultTenantId()) || "").trim();
  if (!tenantId) return { ok: false, reason: "missing_tenant" as const };

  // FIX: Validar amountInCents si se proporciona (no puede ser 0 o negativo)
  const expectedAmount = args.amountInCents != null ? Math.trunc(Number(args.amountInCents)) : null;
  if (expectedAmount != null && expectedAmount <= 0) {
    console.warn('[WompiReconcile] Invalid amountInCents provided', { amountInCents: args.amountInCents });
  }
  
  const expectedCurrency = String(args.currency || "").trim().toUpperCase();
  const expectedLink = String(args.paymentLinkId || "").trim();

  const publicKey = await getWompiPublicKey();
  const privateKey = await getWompiPrivateKey();
  if (!publicKey && !privateKey) {
    return { ok: false, reason: "wompi_credentials_not_configured" as const };
  }
  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey: privateKey || "unused", checkoutLinkBaseUrl });

  const listByKey = async (key: string) => wompi.listTransactionsByReference(reference, key);
  const txs = await (async () => {
    if (publicKey) {
      try {
        const out = await listByKey(publicKey);
        if (out.length) return out;
      } catch {
        // Fallback to private key when public-key lookup fails.
      }
    }
    if (privateKey) return listByKey(privateKey);
    return [];
  })();

  if (!txs.length) return { ok: false, reason: "transaction_not_found_by_reference" as const };
  const finalStatuses = new Set(["APPROVED", "DECLINED", "VOIDED", "ERROR"]);
  const candidates = txs
    .map((tx) => {
      const status = normalizeStatus(tx.status);
      if (!finalStatuses.has(status)) return null;
      let score = 0;
      if (expectedLink && String(tx.paymentLinkId || "").trim() === expectedLink) score += 100;
      if (expectedCurrency && String(tx.currency || "").trim().toUpperCase() === expectedCurrency) score += 20;
      // FIX: Solo sumar puntos por amount si expectedAmount es válido (> 0)
      if (expectedAmount != null && expectedAmount > 0 && Number(tx.amountInCents || 0) === expectedAmount) score += 20;
      if (status === "APPROVED") score += 10;
      const ts = Math.max(parseDateLike(tx.finalizedAt), parseDateLike(tx.createdAt));
      return { tx, score, ts };
    })
    .filter(Boolean) as Array<{ tx: (typeof txs)[number]; score: number; ts: number }>;

  if (!candidates.length) return { ok: false, reason: "status_not_final" as const };
  candidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.ts - a.ts));
  const winner = candidates[0]?.tx;
  if (!winner?.id) return { ok: false, reason: "transaction_not_found_by_reference" as const };

  return reconcileWompiTransaction({
    wompiTransactionId: winner.id,
    tenantId,
    processNow: args.processNow,
    checksumPrefix: args.checksumPrefix || "reconcile-ref"
  });
}
