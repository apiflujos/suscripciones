import type { Request, Response } from "express";
import { GamificationEntityType, LogLevel } from "@prisma/client";
import { prisma } from "../db/prisma";
import { systemLog } from "../services/systemLog";
import { redactHeaders } from "../lib/redact";
import { getDefaultTenantId } from "../services/tenantContext";
import { applyGamificationEvent, GAMIFICATION_EVENT_KINDS } from "../services/gamification";

function getContactFromPayload(payload: any) {
  if (payload?.contact && typeof payload.contact === "object") return payload.contact;
  if (payload?.data?.contact && typeof payload.data.contact === "object") return payload.data.contact;
  if (payload?.contact_inbox?.contact && typeof payload.contact_inbox.contact === "object") return payload.contact_inbox.contact;
  return null;
}

function getConversationIdFromPayload(payload: any) {
  const conversation = payload?.conversation || payload?.data?.conversation;
  if (conversation && typeof conversation === "object" && Number.isFinite(Number(conversation.id))) return Number(conversation.id);
  const id = payload?.conversation_id ?? payload?.conversationId;
  return Number.isFinite(Number(id)) ? Number(id) : null;
}

function getMessageFromPayload(payload: any) {
  if (payload?.message && typeof payload.message === "object") return payload.message;
  if (payload?.data?.message && typeof payload.data.message === "object") return payload.data.message;
  if (payload?.data?.conversation?.last_message && typeof payload.data.conversation.last_message === "object") {
    return payload.data.conversation.last_message;
  }
  return null;
}

function isIncomingMessage(payload: any) {
  const message = getMessageFromPayload(payload);
  const rawType = message?.message_type ?? message?.messageType ?? message?.direction ?? payload?.message_type;
  if (rawType === 0 || rawType === "incoming") return true;
  const normalized = String(rawType || "").toLowerCase();
  return normalized === "incoming" || normalized === "inbound";
}

function messageTimestamp(payload: any) {
  const message = getMessageFromPayload(payload);
  const raw = message?.created_at ?? message?.createdAt ?? payload?.timestamp ?? null;
  if (raw == null) return new Date();
  if (typeof raw === "number") {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : new Date();
  }
  const d = new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d : new Date();
}

export async function chatwootWebhook(req: Request, res: Response) {
  const requiredToken = String(process.env.CHATWOOT_WEBHOOK_TOKEN || "").trim();
  if (!requiredToken && process.env.NODE_ENV === "production") {
    res.status(503).json({ error: "chatwoot_webhook_token_not_configured" });
    return;
  }
  if (requiredToken) {
    const headerToken = String(req.header("x-chatwoot-token") || "").trim();
    const auth = String(req.header("authorization") || "");
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const queryToken = String((req.query as any)?.token || "").trim();
    const provided = headerToken || bearer || queryToken;
    if (!provided || provided !== requiredToken) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  const payload = req.body ?? {};
  const event = String(payload?.event || payload?.event_type || "").trim() || "unknown";

  const contact = getContactFromPayload(payload);
  const contactId = contact?.id != null ? Number(contact.id) : null;
  const email = contact?.email ? String(contact.email).trim().toLowerCase() : "";
  const phone = contact?.phone_number ? String(contact.phone_number).trim() : "";
  const name = contact?.name ? String(contact.name).trim() : "";
  const sourceId =
    contact?.contact_inboxes?.[0]?.source_id ||
    payload?.contact_inbox?.source_id ||
    payload?.contact_inbox?.sourceId ||
    undefined;

  const conversationId = getConversationIdFromPayload(payload);

  let customer: any = null;

  if (contactId && Number.isFinite(contactId)) {
    customer = await prisma.customer.findFirst({
      where: { metadata: { path: ["chatwoot", "contactId"], equals: contactId } as any }
    });
  }
  if (!customer && email) {
    customer = await prisma.customer.findUnique({ where: { email } });
  }
  if (!customer && phone) {
    customer = await prisma.customer.findFirst({ where: { phone } });
  }

  const incoming = isIncomingMessage(payload);
  const eventAt = messageTimestamp(payload).toISOString();

  if (customer) {
    const meta: any = (customer.metadata ?? {}) as any;
    const merged = {
      ...(meta && typeof meta === "object" ? meta : {}),
      chatwoot: {
        ...(meta?.chatwoot || {}),
        contactId: contactId ?? meta?.chatwoot?.contactId,
        sourceId: sourceId ?? meta?.chatwoot?.sourceId,
        ...(conversationId ? { conversationId } : {}),
        lastEvent: event,
        lastEventAt: eventAt,
        ...(conversationId ? { lastConversationId: conversationId } : {}),
        ...(incoming
          ? { lastIncomingAt: eventAt, followupCount: 0, followupMaxedAt: null }
          : { lastOutgoingAt: eventAt })
      }
    };

    const updatedCustomer = await prisma.customer
      .update({
        where: { id: customer.id },
        data: {
          name: customer.name || name || undefined,
          phone: customer.phone || phone || undefined,
          email: customer.email || email || undefined,
          metadata: merged as any
        }
      })
      .catch(() => {});
    if (updatedCustomer) customer = updatedCustomer;
  } else if (contactId || email || phone) {
    const tenantId = await getDefaultTenantId();
    if (!tenantId) {
      return res.status(503).json({ error: "tenant_not_configured" });
    }
    const merged = {
      chatwoot: {
        contactId: contactId ?? undefined,
        sourceId: sourceId ?? undefined,
        ...(conversationId ? { conversationId } : {}),
        lastEvent: event,
        lastEventAt: eventAt,
        ...(conversationId ? { lastConversationId: conversationId } : {}),
        ...(incoming
          ? { lastIncomingAt: eventAt, followupCount: 0, followupMaxedAt: null }
          : { lastOutgoingAt: eventAt })
      }
    };
    const createdCustomer = await prisma.customer
      .create({
        data: {
          tenantId,
          name: name || undefined,
          email: email || undefined,
          phone: phone || undefined,
          metadata: merged as any
        }
      })
      .catch(() => {});
    if (createdCustomer) customer = createdCustomer;
  }

  if (incoming && customer?.id) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: customer.id,
      tenantId: customer.tenantId || null,
      kind: GAMIFICATION_EVENT_KINDS.CHATWOOT_MESSAGE_IN,
      metadata: { event, contactId, conversationId }
    }).catch(() => {});
  }

  await systemLog(LogLevel.INFO, "webhooks.chatwoot", `event:${event}`, {
    event,
    contactId,
    conversationId,
    hasContact: !!contact,
    headers: redactHeaders(req.headers as any)
  }).catch(() => {});

  res.json({ ok: true });
}
