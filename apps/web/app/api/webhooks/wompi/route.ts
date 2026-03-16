import type { Request, Response } from "express";
import { wompiEventSchema } from "../webhooks/wompi/types";
import { verifyWompiSignature } from "../webhooks/wompi/verifySignature";
import { prisma } from "../db/prisma";
import { RetryJobType, WebhookProvider, LogLevel } from "@prisma/client";
import { getWompiEventsSecret } from "../services/runtimeConfig";
import { getShopifyForward } from "../services/runtimeConfig";
import { systemLog, SystemActor } from "../services/systemLog";
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
    console.error('[Webhooks/Wompi] Payload inválido', {
      error: parsed.error.flatten(),
      body: req.body
    });
    res.status(400).json({ error: "payload_invalido", detalles: parsed.error.flatten() });
    return;
  }

  const eventsSecret = await getWompiEventsSecret();
  if (!eventsSecret) {
    console.error('[Webhooks/Wompi] Events secret no configurado');
    res.status(503).json({ error: "secreto_de_eventos_no_configurado", mensaje: "WOMPI_EVENTS_SECRET no está configurado" });
    return;
  }

  const signature = verifyWompiSignature({
    event: parsed.data,
    eventsSecret,
    checksumHeader: getChecksumHeader(req)
  });
  if (!signature.ok) {
    console.warn('[Webhooks/Wompi] Firma inválida', {
      reason: signature.reason,
      event: parsed.data.event,
      timestamp: parsed.data.timestamp
    });
    res.status(400).json({ error: "firma_invalida", razon: signature.reason });
    return;
  }

  const checksum = (getChecksumHeader(req) || parsed.data.signature.checksum).trim();

  try {
    const tenantId = (await resolveWebhookTenantId(parsed.data)) || (await getDefaultTenantId());
    if (!tenantId) {
      console.error('[Webhooks/Wompi] Tenant no configurado', {
        event: parsed.data.event,
        reference: (parsed.data as any)?.data?.transaction?.reference
      });
      res.status(503).json({ error: "tenant_no_configurado", mensaje: "No se pudo resolver el tenant para este webhook" });
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

    console.log('[Webhooks/Wompi] Webhook recibido', {
      webhookEventId: webhookEvent.id,
      event: parsed.data.event,
      tenantId,
      transactionId: (parsed.data as any)?.data?.transaction?.id
    });

    await prisma.retryJob.create({
      data: {
        type: RetryJobType.PROCESS_WOMPI_EVENT,
        payload: { webhookEventId: webhookEvent.id }
      }
    });

    try {
      await processWompiEventLogic(webhookEvent.id, prisma);
      console.log('[Webhooks/Wompi] Procesamiento inline exitoso', { webhookEventId: webhookEvent.id });
    } catch (inlineErr: any) {
      console.error('[Webhooks/Wompi] Fallo en procesamiento inline', {
        webhookEventId: webhookEvent.id,
        error: inlineErr?.message || String(inlineErr)
      });
      await systemLog(LogLevel.WARN, "webhooks.wompi", "Inline processing failed; queued for retry job", {
        webhookEventId: webhookEvent.id,
        error: String((inlineErr as any)?.message || inlineErr || "unknown_error")
      }, SystemActor.WEBHOOK_WOMPI).catch((logErr) => {
        console.error('[Webhooks/Wompi] Fallo creando systemLog', { error: logErr?.message });
      });
    }

    const shopify = await getShopifyForward();
    if (shopify.url) {
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
          payload: { webhookEventId: webhookEvent.id }
        }
      });
      console.log('[Webhooks/Wompi] Job de forward a Shopify creado', { webhookEventId: webhookEvent.id });
    }
  } catch (err: any) {
    if (String(err?.code) === "P2002") {
      console.log('[Webhooks/Wompi] Webhook duplicado (idempotencia)', {
        checksum,
        event: parsed.data.event
      });
      res.json({ ok: true, deduped: true });
      return;
    }
    console.error('[Webhooks/Wompi] Error procesando webhook', {
      event: parsed.data.event,
      error: err?.message || String(err),
      stack: err?.stack
    });
    throw err;
  }

  res.json({ ok: true });
}
