import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { ChatwootMessageType, MessageStatus, LogLevel, RetryJobType } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { getClientOrThrow, sanitizeChatwootContent, DEDUPE_WINDOW_MS } from "../_lib";
import { syncChatwootAttributesForCustomer } from "@suscripciones/core/services/chatwootSync";
import { sendChatwootMessage } from "@suscripciones/core/jobs/handlers/sendChatwootMessage";
import { getDefaultTenantId, getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { systemLog } from "@suscripciones/core/services/systemLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const messageSchema = z.object({
  conversationId: z.number().int().positive().optional(),
  customerId: z.string().min(1).optional(),
  content: z.string().min(1),
  templateParams: z.any().optional(),
  attachmentUrl: z.string().url().optional(),
  inboxId: z.number().int().positive().optional(),
  type: z.nativeEnum(ChatwootMessageType).optional(),
  sendNow: z.boolean().optional()
});

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const msgType = parsed.data.type || ChatwootMessageType.PAYMENT_LINK;
  const sendNow = parsed.data.sendNow !== false;
  const cleanContent = sanitizeChatwootContent(parsed.data.content, parsed.data.attachmentUrl);

  const client = await getClientOrThrow().catch((err) => ({ error: err?.message || "chatwoot_not_configured" } as any));
  if ((client as any)?.error) return Response.json({ error: (client as any).error }, { status: 400 });

  let conversationId = parsed.data.conversationId;
  let customer: { id: string; tenantId: string | null; metadata?: any } | null = null;

  if (!conversationId && parsed.data.customerId) {
    customer = await prisma.customer.findUnique({
      where: { id: parsed.data.customerId },
      select: { id: true, tenantId: true, metadata: true }
    });
    if (!customer) return Response.json({ error: "customer_not_found" }, { status: 404 });

    const meta: any = (customer.metadata ?? {}) as any;
    const knownContactId = meta?.chatwoot?.contactId;
    const knownSourceId = meta?.chatwoot?.sourceId;

    try {
      if (!knownContactId) {
        const synced = await syncChatwootAttributesForCustomer(customer.id);
        if (!synced.ok) return Response.json({ error: synced.reason }, { status: 400 });
        conversationId = (await (client as any).createConversation({ contactId: synced.contactId, sourceId: synced.sourceId }))
          .conversationId;
      } else {
        await syncChatwootAttributesForCustomer(customer.id).catch(() => {});
        conversationId = (await (client as any).createConversation({ contactId: knownContactId, sourceId: knownSourceId }))
          .conversationId;
      }
    } catch (err: any) {
      return Response.json(
        { error: "chatwoot_create_conversation_failed", details: err?.message || "unknown_error" },
        { status: 502 }
      );
    }
  }

  if (!conversationId) return Response.json({ error: "missing_conversation_or_customer" }, { status: 400 });

  if (parsed.data.customerId) {
    const existing = await prisma.chatwootMessage.findFirst({
      where: {
        customerId: parsed.data.customerId,
        type: msgType,
        content: cleanContent,
        status: { in: [MessageStatus.PENDING, MessageStatus.SENT] },
        createdAt: { gt: new Date(Date.now() - DEDUPE_WINDOW_MS) }
      },
      select: { id: true }
    });
    if (existing) {
      await systemLog(LogLevel.WARN, "chatwoot.send", "Mensaje duplicado; omitido", {
        chatwootMessageId: existing.id,
        customerId: parsed.data.customerId,
        type: msgType
      }).catch(() => {});
      return Response.json({ ok: true, duplicated: true, messageId: existing.id });
    }

    const providerResp: any = {};
    if (parsed.data.templateParams) providerResp.template_params = parsed.data.templateParams;
    if (parsed.data.attachmentUrl) providerResp.attachment = { url: parsed.data.attachmentUrl };
    if (Number.isFinite(parsed.data.inboxId)) providerResp.inboxId = parsed.data.inboxId;

    const compatReq = reqToCompat(req, body);
    const resolvedTenantId = customer?.tenantId ?? (await getEffectiveTenantId(compatReq as any)) ?? (await getDefaultTenantId());
    if (!resolvedTenantId) return Response.json({ error: "tenant_required" }, { status: 400 });

    const actorEmail = String(body?.actorEmail || new URL(req.url).searchParams.get("actorEmail") || "").trim() || null;
    const actor = actorEmail || "Sistema";

    const created = await prisma.chatwootMessage.create({
      data: {
        tenantId: resolvedTenantId,
        customerId: parsed.data.customerId,
        type: msgType,
        status: MessageStatus.PENDING,
        content: cleanContent,
        actor,
        providerResp: Object.keys(providerResp).length ? (providerResp as any) : null
      }
    });

    if (sendNow) {
      try {
        await sendChatwootMessage(created.id);
        return Response.json({ ok: true, sent: true, messageId: created.id });
      } catch (err: any) {
        return Response.json(
          { ok: false, error: "centralcom_send_failed", messageId: created.id, details: String(err?.message || err) },
          { status: 502 }
        );
      }
    }

    await prisma.retryJob.create({
      data: {
        type: RetryJobType.SEND_CHATWOOT_MESSAGE,
        payload: { chatwootMessageId: created.id }
      }
    });
    return Response.json({ ok: true, queued: true, messageId: created.id });
  }

  const out = parsed.data.templateParams
    ? await (client as any).sendTemplate(conversationId, { content: cleanContent, templateParams: parsed.data.templateParams })
    : await (client as any).sendMessage(conversationId, cleanContent);
  return Response.json(out.raw);
}
