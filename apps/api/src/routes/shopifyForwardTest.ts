import type { Request, Response } from "express";
import { z } from "zod";
import { postJson } from "../lib/http";

const schema = z.object({
  forwardUrl: z.string().url(),
  forwardSecret: z.string().optional().or(z.literal(""))
});

export async function testShopifyForward(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const payload = {
    event: "wompi.forward.test",
    data: {
      origin: "shopify",
      transaction: {
        id: "test_txn",
        origin: "shopify",
        status: "APPROVED",
        amount_in_cents: 1000,
        currency: "COP",
        reference: "SHOPIFY_TEST"
      }
    },
    sent_at: new Date().toISOString(),
    timestamp: Date.now(),
    origin: "shopify"
  };

  const headers = {
    "x-forwarded-by": "wompi-subs-api",
    ...(parsed.data.forwardSecret ? { "x-forwarded-secret": parsed.data.forwardSecret } : {})
  };

  const out = await postJson(parsed.data.forwardUrl, payload, headers);
  if (!out.ok) {
    return res.status(400).json({ error: "forward_failed", status: out.status, text: out.text });
  }
  res.json({ ok: true, status: out.status });
}
