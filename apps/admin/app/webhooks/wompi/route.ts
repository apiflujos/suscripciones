import { wompiEventSchema } from "@suscripciones/core/webhooks/wompi/types";
import { verifyWompiSignature } from "@suscripciones/core/webhooks/wompi/verifySignature";
import { prisma } from "@suscripciones/database";
import { RetryJobType, WebhookProvider, LogLevel } from "@prisma/client";
import { getWompiEventsSecret, getShopifyForward } from "@suscripciones/core/services/runtimeConfig";
import { systemLog, SystemActor } from "@suscripciones/core/services/systemLog";
import { redactHeaders } from "@suscripciones/core/lib/redact";
import { getDefaultTenantId } from "@suscripciones/core/services/tenantContext";
import { processWompiEventLogic } from "@suscripciones/core/jobs/handlers/processWompiEvent";
import { classifyReference } from "@suscripciones/core/webhooks/wompi/classifyReference";
import { tokenMeta } from "@suscripciones/core/lib/tokenMeta";
import { normalizeBearer, verifyJwt } from "../../../lib/jwt";

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
  const body = await req.json().catch(() => null);
  const parsed = wompiEventSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[Webhooks/Wompi] Payload inválido", {
      error: parsed.error.flatten(),
      body
    });
    return Response.json({ error: "payload_invalido", detalles: parsed.error.flatten() }, { status: 400 });
  }

  const eventsSecret = await getWompiEventsSecret();
  if (!eventsSecret) {
    console.error("[Webhooks/Wompi] Events secret no configurado");
    return Response.json(
      { error: "secreto_de_eventos_no_configurado", mensaje: "WOMPI_EVENTS_SECRET no está configurado" },
      { status: 503 }
    );
  }

  const signature = verifyWompiSignature({
    event: parsed.data,
    eventsSecret,
    checksumHeader: getChecksumHeader(req.headers)
  });
  if (!signature.ok) {
    console.warn("[Webhooks/Wompi] Firma inválida", {
      reason: signature.reason,
      event: parsed.data.event,
      timestamp: parsed.data.timestamp
    });
    return Response.json({ error: "firma_invalida", razon: signature.reason }, { status: 400 });
  }

  const authHeader = req.headers.get("authorization") || "";
  const tokenFromAuth = authHeader.toLowerCase().startsWith("bearer ") ? authHeader : "";
  const tokenFromHeader = req.headers.get("x-auth-token") || "";
  const token = normalizeBearer(tokenFromAuth || tokenFromHeader || "");
  const claims: any = token ? await verifyJwt(token) : null;
  const hasJwtPermission = Boolean(
    claims && Array.isArray(claims.permissions) && claims.permissions.includes("webhook:receive")
  );

  if (!hasJwtPermission) {
    const requiredToken = String(process.env.WOMPI_WEBHOOK_TOKEN || "").trim();
    if (requiredToken) {
      const headerToken = String(req.headers.get("x-wompi-token") || "").trim();
      const queryToken = String(new URL(req.url).searchParams.get("token") || "").trim();
      const provided = headerToken || queryToken;
      if (provided !== requiredToken) {
        console.warn("[Webhooks/Wompi] Token requerido pero no coincide; se permite por firma", {
          hasToken: Boolean(provided),
          event: parsed.data.event
        });
      }
    }
  }

  const checksum = (getChecksumHeader(req.headers) || parsed.data.signature.checksum).trim();

  try {
    const tenantId = (await resolveWebhookTenantId(parsed.data)) || (await getDefaultTenantId());
    if (!tenantId) {
      console.error("[Webhooks/Wompi] Tenant no configurado", {
        event: parsed.data.event,
        reference: (parsed.data as any)?.data?.transaction?.reference
      });
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
        actor: claims?.sub || null,
        ...(token ? tokenMeta(token) : {})
      },
      SystemActor.WEBHOOK_WOMPI
    ).catch(() => {});

    console.log("[Webhooks/Wompi] Webhook recibido", {
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
      console.log("[Webhooks/Wompi] Procesamiento inline exitoso", { webhookEventId: webhookEvent.id });
    } catch (inlineErr: any) {
      console.error("[Webhooks/Wompi] Fallo en procesamiento inline", {
        webhookEventId: webhookEvent.id,
        error: inlineErr?.message || String(inlineErr)
      });
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
        console.error("[Webhooks/Wompi] Fallo creando systemLog", { error: logErr?.message });
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
      console.log("[Webhooks/Wompi] Job de forward a Shopify creado", { webhookEventId: webhookEvent.id });
    }
  } catch (err: any) {
    if (String(err?.code) === "P2002") {
      console.log("[Webhooks/Wompi] Webhook duplicado (idempotencia)", {
        checksum,
        event: parsed.data.event
      });
      return Response.json({ ok: true, deduped: true });
    }
    console.error("[Webhooks/Wompi] Error procesando webhook", {
      event: parsed.data.event,
      error: err?.message || String(err),
      stack: err?.stack
    });
    return Response.json({ error: "internal_error" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
