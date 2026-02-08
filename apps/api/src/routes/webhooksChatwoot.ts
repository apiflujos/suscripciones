import type { Request, Response } from "express";
import { LogLevel } from "@prisma/client";
import { prisma } from "../db/prisma";
import { systemLog } from "../services/systemLog";

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

export async function chatwootWebhook(req: Request, res: Response) {
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

  let customer = null;

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
        lastEventAt: new Date().toISOString()
      }
    };

    await prisma.customer
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
  } else if (contactId || email || phone) {
    const merged = {
      chatwoot: {
        contactId: contactId ?? undefined,
        sourceId: sourceId ?? undefined,
        ...(conversationId ? { conversationId } : {}),
        lastEvent: event,
        lastEventAt: new Date().toISOString()
      }
    };
    await prisma.customer
      .create({
        data: {
          name: name || undefined,
          email: email || undefined,
          phone: phone || undefined,
          metadata: merged as any
        }
      })
      .catch(() => {});
  }

  await systemLog(LogLevel.INFO, "webhooks.chatwoot", `event:${event}`, {
    event,
    contactId,
    conversationId,
    hasContact: !!contact,
    headers: req.headers
  }).catch(() => {});

  res.json({ ok: true });
}
