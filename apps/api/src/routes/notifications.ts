import express from "express";
import { z } from "zod";
import { getNotificationsConfig, notificationsConfigSchema, setNotificationsConfig } from "../services/notificationsConfig";
import { schedulePaymentStatusNotifications, scheduleSubscriptionDueNotifications } from "../services/notificationsScheduler";

export const notificationsRouter = express.Router();

notificationsRouter.get("/config", async (_req, res) => {
  const config = await getNotificationsConfig();
  res.json({ config });
});

const putConfigSchema = z.object({
  environment: z.enum(["PRODUCTION", "SANDBOX"]).optional(),
  config: z.unknown()
});

notificationsRouter.put("/config", async (req, res) => {
  const parsed = putConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  try {
    const env = parsed.data.environment;
    const normalized = notificationsConfigSchema.parse(parsed.data.config);
    const saved = await setNotificationsConfig(normalized, { environment: env });
    res.json({ ok: true, config: saved });
  } catch (err: any) {
    res.status(400).json({ error: "invalid_config", message: String(err?.message || err) });
  }
});

notificationsRouter.post("/schedule/subscription/:id", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_subscription_id" });
  const forceNow = String((req.query.forceNow ?? "") as any).trim() === "1";
  const result = await scheduleSubscriptionDueNotifications({ subscriptionId, forceNow });
  res.json({ ok: true, ...result });
});

notificationsRouter.post("/schedule/payment/:id", async (req, res) => {
  const paymentId = String(req.params.id || "").trim();
  if (!paymentId) return res.status(400).json({ error: "invalid_payment_id" });
  const forceNow = String((req.query.forceNow ?? "") as any).trim() === "1";
  const result = await schedulePaymentStatusNotifications({ paymentId, forceNow });
  res.json({ ok: true, ...result });
});

