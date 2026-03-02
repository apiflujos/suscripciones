import express from "express";
import { z } from "zod";
import { getNotificationsConfig, getNotificationsConfigForEnv, notificationsConfigSchema, setNotificationsConfig } from "../services/notificationsConfig";
import { scheduleCatalogLinkNotifications, schedulePaymentStatusNotifications, scheduleSubscriptionDueNotifications, scheduleTokenizationLinkNotifications } from "../services/notificationsScheduler";

export const notificationsRouter = express.Router();

notificationsRouter.get("/config", async (_req, res) => {
  const envRaw = String((_req.query.environment ?? "") as any).trim().toUpperCase();
  const env = envRaw === "SANDBOX" ? "SANDBOX" : envRaw === "PRODUCTION" ? "PRODUCTION" : null;
  const config = env ? await getNotificationsConfigForEnv(env) : await getNotificationsConfig();
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

notificationsRouter.post("/schedule/catalog", async (req, res) => {
  const customerId = String(req?.body?.customerId || "").trim();
  const catalogUrl = String(req?.body?.catalogUrl || "").trim();
  const catalogTypeRaw = String(req?.body?.catalogType || "").trim().toUpperCase();
  const catalogType = catalogTypeRaw === "SUBSCRIPTION" ? "SUBSCRIPTION" : catalogTypeRaw === "PLAN" ? "PLAN" : "";
  if (!customerId || !catalogUrl) return res.status(400).json({ error: "invalid_payload" });
  const forceNow = String((req.query.forceNow ?? "") as any).trim() === "1";
  const result = await scheduleCatalogLinkNotifications({ customerId, catalogUrl, forceNow, paymentType: catalogType });
  res.json({ ok: true, ...result });
});

notificationsRouter.post("/schedule/tokenization", async (req, res) => {
  const customerId = String(req?.body?.customerId || "").trim();
  const tokenUrl = String(req?.body?.tokenUrl || "").trim();
  if (!customerId || !tokenUrl) return res.status(400).json({ error: "invalid_payload" });
  const forceNow = String((req.query.forceNow ?? "") as any).trim() === "1";
  const result = await scheduleTokenizationLinkNotifications({ customerId, tokenUrl, forceNow });
  res.json({ ok: true, ...result });
});
