import type { Request, Response } from "express";
import { z } from "zod";
import { postJson } from "../lib/http";
import { getShopifyForward } from "../services/runtimeConfig";

const schema = z.object({
  forwardUrl: z.string().url().optional().or(z.literal("")),
  forwardSecret: z.string().optional().or(z.literal("")),
  forwardOrigin: z.enum(["shopify", "shopify-native"]).optional().or(z.literal(""))
});

export async function testShopifyForward(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const stored = await getShopifyForward();
  const forwardUrl = parsed.data.forwardUrl || stored.url || "";
  const forwardSecret = parsed.data.forwardSecret || stored.secret || "";
  const origin = parsed.data.forwardOrigin || stored.origin || "shopify";

  if (!forwardUrl) {
    return res.status(400).json({ error: "forward_not_configured" });
  }
  const payload = {
    event: "wompi.forward.test",
    data: {
      origin,
      transaction: {
        id: "test_txn",
        origin,
        status: "APPROVED",
        amount_in_cents: 1000,
        currency: "COP",
        reference: "SHOPIFY_TEST"
      }
    },
    sent_at: new Date().toISOString(),
    timestamp: Date.now(),
    origin
  };

  const headers = {
    "x-forwarded-by": "wompi-subs-api",
    ...(parsed.data.forwardSecret ? { "x-forwarded-secret": parsed.data.forwardSecret } : {})
  };

  const out = await postJson(forwardUrl, payload, headers);
  if (!out.ok) {
    return res.status(400).json({ error: "forward_failed", status: out.status, text: out.text });
  }
  res.json({ ok: true, status: out.status });
}
