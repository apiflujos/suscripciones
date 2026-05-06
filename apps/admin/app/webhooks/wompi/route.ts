import { wompiEventSchema } from "@suscripciones/core/webhooks/wompi/types";
import { verifyWompiSignature } from "@suscripciones/core/webhooks/wompi/verifySignature";
import { prisma } from "@suscripciones/database";
import { RetryJobType, WebhookProvider, LogLevel } from "@prisma/client";
import { getWompiEventsSecret, getWompiEventsSecrets, getShopifyForward } from "@suscripciones/core/services/runtimeConfig";
import { systemLog, SystemActor } from "@suscripciones/core/services/systemLog";
import { redactHeaders } from "@suscripciones/core/lib/redact";
import { getDefaultTenantId } from "@suscripciones/core/services/tenantContext";
import { processWompiEventLogic } from "@suscripciones/core/jobs/handlers/processWompiEvent";
import { classifyReference, isShopifyLikePayload } from "@suscripciones/core/webhooks/wompi/classifyReference";
import { logger } from "@suscripciones/core/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getChecksumHeader(headers: Headers): string | undefined {
  const h = headers.get("x-event-checksum") || headers.get("x-wompi-checksum");
  return h || undefined;
}

function normalizeRef(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getTxFromPayload(payload: any): Record<string, unknown> | null {
  const tx = payload?.data?.transaction;
  return tx && typeof tx === "object" ? (tx as Record<string, unknown>) : null;
}

function shouldForwardPayloadToShopify(payload: any): boolean {
  return isShopifyLikePayload(payload);
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

export async function POST(req: Request) {
  const body = await req.json().catch((err: any) => {
    logger.warn({ err }, "Body invalido en webhook Wompi");
    return null;
  });
  const parsed = wompiEventSchema.safeParse(body);
  if (!parsed.success) {
    logger.error({
      error: parsed.error.flatten(),
      body
    }, "[Webhooks/Wompi] Payload inválido");
    return Response.json({ error: "payload_invalido", detalles: parsed.error.flatten() }, { status: 400 });
  }

  const eventsSecrets = await getWompiEventsSecrets();
  const candidates = Array.from(
    new Set(
      [eventsSecrets.active, eventsSecrets.production, eventsSecrets.sandbox].map((v) => (v || "").trim()).filter(Boolean)
    )
  );
  if (!candidates.length) {
    logger.error({}, "[Webhooks/Wompi] Events secret no configurado");
    return Response.json(
      { error: "secreto_de_eventos_no_configurado", mensaje: "WOMPI_EVENTS_SECRET no está configurado" },
      { status: 503 }
    );
  }

  let signature = { ok: false, reason: "no_secret" } as ReturnType<typeof verifyWompiSignature>;
  for (const secret of candidates) {
    const res = verifyWompiSignature({
      event: parsed.data,
      eventsSecret: secret,
      checksumHeader: getChecksumHeader(req.headers)
    });
    if (res.ok) {
      signature = res;
      break;
    }
    signature = res;
  }
  if (!signature.ok) {
    logger.warn({
      reason: signature.reason,
      event: parsed.data.event,
      timestamp: parsed.data.timestamp
    }, "[Webhooks/Wompi] Firma inválida");
    try {
      const tenantId = (await resolveWebhookTenantId(parsed.data)) || (await getDefaultTenantId());
      if (tenantId) {
        const headersObj = Object.fromEntries(req.headers.entries());
        await prisma.webhookEvent.create({
          data: {
            tenantId,
            provider: WebhookProvider.WOMPI,
            checksum: (getChecksumHeader(req.headers) || parsed.data.signature.checksum).trim(),
            eventName: parsed.data.event,
            providerTs: parsed.data.timestamp != null ? BigInt(parsed.data.timestamp) : null,
            headers: redactHeaders(headersObj as any) as any,
            payload: parsed.data as any,
            processStatus: "FAILED",
            errorMessage: signature.reason || "firma_invalida"
          }
        });
      }
    } catch (err: any) {
      logger.warn({ err, event: parsed.data.event }, "Fallo persistiendo intento de webhook Wompi con firma invalida");
    }
    return Response.json({ error: "firma_invalida", razon: signature.reason }, { status: 400 });
  }

  const checksum = (getChecksumHeader(req.headers) || parsed.data.signature.checksum).trim();

  try {
    const tenantId = (await resolveWebhookTenantId(parsed.data)) || (await getDefaultTenantId());
    if (!tenantId) {
      logger.error({
        event: parsed.data.event,
        reference: (parsed.data as any)?.data?.transaction?.reference
      }, "[Webhooks/Wompi] Tenant no configurado");
      return Response.json(
        { error: "tenant_no_configurado", mensaje: "No se pudo resolver el tenant para este webhook" },
        { status: 503 }
      );
    }

    const headersObj = Object.fromEntries(req.headers.entries());

    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: WebhookProvider.WOMPI,
        checksum,
        eventName: parsed.data.event,
        providerTs: parsed.data.timestamp != null ? BigInt(parsed.data.timestamp) : null,
        headers: redactHeaders(headersObj as any) as any,
        payload: parsed.data as any
      }
    });

    await systemLog(
      LogLevel.INFO,
      "webhooks.wompi",
      "webhook_received",
      {
        webhookEventId: webhookEvent.id,
        tenantId,
        actor: "wompi"
      },
      SystemActor.WEBHOOK_WOMPI
    ).catch((err: any) => {
      logger.warn({ err, webhookEventId: webhookEvent.id, tenantId }, "Fallo escribiendo systemLog de webhook Wompi recibido");
    });

    logger.info({
      webhookEventId: webhookEvent.id,
      event: parsed.data.event,
      tenantId,
      transactionId: (parsed.data as any)?.data?.transaction?.id
    }, "[Webhooks/Wompi] Webhook recibido");

    // FIX #3: Deduplicar jobs de PROCESS_WOMPI_EVENT.
    // Si Wompi reenvía el mismo webhook, ya existe un job encolado.
    // Evitar inflación innecesaria de la cola de jobs.
    const existingJob = await prisma.retryJob.findFirst({
      where: {
        type: RetryJobType.PROCESS_WOMPI_EVENT,
        payload: { path: ["webhookEventId"], equals: webhookEvent.id } as any
      },
      select: { id: true, status: true }
    });

    if (!existingJob) {
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.PROCESS_WOMPI_EVENT,
          payload: { webhookEventId: webhookEvent.id }
        }
      });
    } else {
      logger.info({
        webhookEventId: webhookEvent.id,
        existingJobId: existingJob.id,
        existingStatus: existingJob.status
      }, "[Webhooks/Wompi] Job ya existe (deduplicado)");
    }

    try {
      await processWompiEventLogic(webhookEvent.id, prisma);
      logger.info({ webhookEventId: webhookEvent.id }, "[Webhooks/Wompi] Procesamiento inline exitoso");
    } catch (inlineErr: any) {
      logger.error({
        webhookEventId: webhookEvent.id,
        error: inlineErr?.message || String(inlineErr)
      }, "[Webhooks/Wompi] Fallo en procesamiento inline");
      await systemLog(
        LogLevel.WARN,
        "webhooks.wompi",
        "Inline processing failed; queued for retry job",
        {
          webhookEventId: webhookEvent.id,
          error: String((inlineErr as any)?.message || inlineErr || "unknown_error")
        },
        SystemActor.WEBHOOK_WOMPI
      ).catch((logErr) => {
        logger.error({ error: logErr?.message }, "[Webhooks/Wompi] Fallo creando systemLog");
      });
    }

    const shopify = await getShopifyForward();
    if (shopify.url && shouldForwardPayloadToShopify(parsed.data)) {
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
          payload: { webhookEventId: webhookEvent.id },
          maxAttempts: 3
        }
      });
      logger.info({ webhookEventId: webhookEvent.id }, "[Webhooks/Wompi] Job de forward a Shopify creado");
    }
  } catch (err: any) {
    if (String(err?.code) === "P2002") {
      logger.info({
        checksum,
        event: parsed.data.event
      }, "[Webhooks/Wompi] Webhook duplicado (idempotencia)");
      return Response.json({ ok: true, deduped: true });
    }
    logger.error({
      event: parsed.data.event,
      error: err?.message || String(err),
      stack: err?.stack
    }, "[Webhooks/Wompi] Error procesando webhook");
    return Response.json({ error: "internal_error" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
