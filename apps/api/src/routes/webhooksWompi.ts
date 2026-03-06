import type { Request, Response } from "express";
import { wompiEventSchema } from "../webhooks/wompi/types";
import { verifyWompiSignature } from "../webhooks/wompi/verifySignature";
import { prisma } from "../db/prisma";
import { RetryJobType, WebhookProvider } from "@prisma/client";
import { getWompiEventsSecret } from "../services/runtimeConfig";
import { getShopifyForward } from "../services/runtimeConfig";
import { systemLog } from "../services/systemLog";
import { LogLevel } from "@prisma/client";
import { redactHeaders } from "../lib/redact";
import { getDefaultTenantId } from "../services/tenantContext";
import { processWompiEventLogic } from "../jobs/handlers/processWompiEvent";
import { classifyReference } from "../webhooks/wompi/classifyReference";

function getChecksumHeader(req: Request): string | undefined {
  const h = req.header("x-event-checksum") || req.header("x-wompi-checksum");
  return h || undefined;
}

function normalizeRef(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getTxFromPayload(payload: any): Record<string, unknown> | null {
  const tx = payload?.data?.transaction;
  return tx && typeof tx === "object" ? (tx as Record<string, unknown>) : null;
}

async function resolveWebhookTenantId(payload: any): Promise<string | null> {
  const tx = getTxFromPayload(payload);
  const transactionId = normalizeRef(tx?.id);
  const reference = normalizeRef(tx?.reference);
  const paymentLinkId =
    normalizeRef(tx?.payment_link_id) ||
    normalizeRef((tx?.payment_link as any)?.id) ||
    normalizeRef((payload?.data as any)?.payment_link_id);

  if (transactionId) {
    const byTx = await prisma.payment.findUnique({
      where: { wompiTransactionId: transactionId },
      select: { tenantId: true }
    });
    if (byTx?.tenantId) return byTx.tenantId;
  }

  if (paymentLinkId) {
    const byLink = await prisma.paymentLink.findUnique({
      where: { wompiPaymentLinkId: paymentLinkId },
      select: { tenantId: true }
    });
    if (byLink?.tenantId) return byLink.tenantId;
  }

  if (reference) {
    const classified = classifyReference(reference);
    if (classified.kind === "subscription" && classified.subscriptionId) {
      const sub = await prisma.subscription.findUnique({
        where: { id: classified.subscriptionId },
        select: { tenantId: true }
      });
      if (sub?.tenantId) return sub.tenantId;
    }
    const byReference = await prisma.payment.findFirst({
      where: { reference },
      orderBy: { createdAt: "desc" },
      select: { tenantId: true }
    });
    if (byReference?.tenantId) return byReference.tenantId;
  }

  return null;
}

export async function wompiWebhook(req: Request, res: Response) {
  const parsed = wompiEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid payload" });
    return;
  }

  const eventsSecret = await getWompiEventsSecret();
  if (!eventsSecret) {
    res.status(503).json({ error: "wompi_events_secret_not_configured" });
    return;
  }

  const signature = verifyWompiSignature({
    event: parsed.data,
    eventsSecret,
    checksumHeader: getChecksumHeader(req)
  });
  if (!signature.ok) {
    res.status(400).json({ error: "invalid signature", reason: signature.reason });
    return;
  }

  const checksum = (getChecksumHeader(req) || parsed.data.signature.checksum).trim();

  try {
    const tenantId = (await resolveWebhookTenantId(parsed.data)) || (await getDefaultTenantId());
    if (!tenantId) {
      res.status(503).json({ error: "tenant_not_configured" });
      return;
    }
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: WebhookProvider.WOMPI,
        checksum,
        eventName: parsed.data.event,
        providerTs: parsed.data.timestamp != null ? BigInt(parsed.data.timestamp) : null,
        headers: redactHeaders(req.headers as any) as any,
        payload: parsed.data as any
      }
    });

    // Evita ruido en campanita: el detalle útil se registra en el procesamiento
    // (pago aprobado/fallido/conciliado), no en cada recepción cruda de webhook.

    await prisma.retryJob.create({
      data: {
        type: RetryJobType.PROCESS_WOMPI_EVENT,
        payload: { webhookEventId: webhookEvent.id }
      }
    });

    // Safety net: process immediately so payments are reconciled
    // even if the background jobs runner is down or delayed.
    try {
      await processWompiEventLogic(webhookEvent.id, prisma);
    } catch (inlineErr) {
      await systemLog(LogLevel.WARN, "webhooks.wompi", "Inline processing failed; queued for retry job", {
        webhookEventId: webhookEvent.id,
        error: String((inlineErr as any)?.message || inlineErr || "unknown_error")
      }).catch(() => {});
    }

    const shopify = await getShopifyForward();
    if (shopify.url) {
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
          payload: { webhookEventId: webhookEvent.id }
        }
      });
    }
  } catch (err: any) {
    // Idempotencia: checksum unique.
    if (String(err?.code) === "P2002") {
      res.json({ ok: true, deduped: true });
      return;
    }
    throw err;
  }

  res.json({ ok: true });
}
