import type { Request, Response } from "express";
import { wompiEventSchema } from "../webhooks/wompi/types";
import { verifyWompiSignature } from "../webhooks/wompi/verifySignature";
import { prisma } from "../db/prisma";
import { RetryJobType, WebhookProvider } from "@prisma/client";

function getChecksumHeader(req: Request): string | undefined {
  const h = req.header("x-event-checksum") || req.header("x-wompi-checksum");
  return h || undefined;
}

export async function wompiWebhook(req: Request, res: Response) {
  const parsed = wompiEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid payload" });
    return;
  }

  const signature = verifyWompiSignature({
    event: parsed.data,
    eventsSecret: process.env.WOMPI_EVENTS_SECRET!,
    checksumHeader: getChecksumHeader(req)
  });
  if (!signature.ok) {
    res.status(400).json({ error: "invalid signature", reason: signature.reason });
    return;
  }

  const checksum = (getChecksumHeader(req) || parsed.data.signature.checksum).trim();

  try {
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        provider: WebhookProvider.WOMPI,
        checksum,
        eventName: parsed.data.event,
        providerTs: parsed.data.timestamp != null ? BigInt(parsed.data.timestamp) : null,
        headers: req.headers as any,
        payload: parsed.data as any
      }
    });

    await prisma.retryJob.create({
      data: {
        type: RetryJobType.PROCESS_WOMPI_EVENT,
        payload: { webhookEventId: webhookEvent.id }
      }
    });
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

