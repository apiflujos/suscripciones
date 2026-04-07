import { prisma } from "@suscripciones/database";
import { LogLevel } from "@prisma/client";
import { sha256Hex } from "@suscripciones/core/lib/crypto";
import { redactHeaders } from "@suscripciones/core/lib/redact";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { verifyWebhookSecret } from "@suscripciones/core/services/webhookSecrets";
import { logger } from "@suscripciones/core/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAuthSecret(headers: Headers): string {
  const h = headers.get("x-webhook-secret") || "";
  if (h) return h.trim();
  const auth = headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function normalizeEventName(payload: any, headers: Headers): string {
  return (
    String(headers.get("x-event-name") || "").trim() ||
    String(payload?.event || payload?.type || payload?.action || "").trim() ||
    "incoming"
  );
}

function normalizeProviderTs(payload: any): bigint | null {
  const raw = payload?.timestamp ?? payload?.created_at ?? payload?.createdAt ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.trunc(n));
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string }> }) {
  const params = await ctx.params;
  const path = String(params?.path || "").trim();
  if (!path) return Response.json({ error: "not_found" }, { status: 404 });

  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { path } });
  if (!endpoint || !endpoint.active) return Response.json({ error: "not_found" }, { status: 404 });

  const provided = getAuthSecret(req.headers);
  if (!verifyWebhookSecret(provided || "", endpoint.secretSalt, endpoint.secretHash)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawBody = await req.text().catch(() => "");
  let payload: any = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (err: any) {
    logger.warn({ err, path }, "Payload no JSON en webhook entrante; se guardará raw");
    payload = { raw: rawBody };
  }

  const checksum = sha256Hex(`${endpoint.id}:${rawBody || JSON.stringify(payload || {})}`);
  const eventName = normalizeEventName(payload, req.headers);
  const providerTs = normalizeProviderTs(payload);
  const headersObj = Object.fromEntries(req.headers.entries());

  try {
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        tenantId: endpoint.tenantId,
        provider: endpoint.provider,
        checksum,
        eventName,
        providerTs,
        headers: redactHeaders(headersObj as any) as any,
        payload: payload as any
      }
    });

    await systemLog(
      LogLevel.INFO,
      "webhooks.incoming",
      "webhook_received",
      { webhookEventId: webhookEvent.id, endpointId: endpoint.id, provider: endpoint.provider },
      "webhook:incoming"
    ).catch((err: any) => {
      logger.warn({ err, webhookEventId: webhookEvent.id, endpointId: endpoint.id }, "Fallo escribiendo systemLog de webhook incoming");
    });
  } catch (err: any) {
    if (String(err?.code) === "P2002") {
      return Response.json({ ok: true, deduped: true });
    }
    logger.error({ err, path, provider: endpoint.provider, eventName }, "Fallo persistiendo webhook entrante");
    return Response.json({ error: "internal_error" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
