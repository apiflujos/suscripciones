import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { health, healthz } from "./routes/health";
import { requireAdminToken, listWebhookEvents } from "./routes/admin";
import { wompiWebhook } from "./routes/webhooksWompi";
import { plansRouter } from "./routes/plans";
import { customersRouter } from "./routes/customers";
import { subscriptionsRouter } from "./routes/subscriptions";
import { productsRouter } from "./routes/products";
import { ordersRouter } from "./routes/orders";
import { settingsRouter } from "./routes/settings";
import { logsRouter } from "./routes/logs";
import { notificationsRouter } from "./routes/notifications";
import { metricsRouter } from "./routes/metrics";
import { superAdminRouter } from "./routes/superAdmin";
import { authRouter } from "./routes/auth";
import { chatwootRouter } from "./routes/chatwoot";
import { chatwootWebhook } from "./routes/webhooksChatwoot";
import { commsRouter } from "./routes/comms";

export function createApp() {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "base-uri": ["'self'"],
          "object-src": ["'none'"],
          "frame-ancestors": ["'none'"],
          "img-src": ["'self'", "data:", "https:"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"]
        }
      }
    })
  );
  const corsOriginsRaw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "";
  const corsOrigins = corsOriginsRaw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const isProd = process.env.NODE_ENV === "production";
  app.use(
    cors(
      corsOrigins.length
        ? { origin: corsOrigins, credentials: true }
        : isProd
          ? { origin: false }
          : { origin: true }
    )
  );
  app.use(express.json({ limit: "2mb" }));

  const rateLimitWindowMs = Math.max(10_000, Number(process.env.RATE_LIMIT_WINDOW_MS || 600_000));
  const rateLimitMax = Math.max(10, Number(process.env.RATE_LIMIT_MAX || 600));
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  let rateRequests = 0;
  app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/healthz") return next();
    const forwarded = String(req.header("x-forwarded-for") || "").split(",")[0]?.trim();
    const key = forwarded || req.ip || "unknown";
    const now = Date.now();
    rateRequests += 1;
    if (rateRequests % 200 === 0 && rateBuckets.size) {
      for (const [k, v] of rateBuckets.entries()) {
        if (now >= v.resetAt) rateBuckets.delete(k);
      }
    }
    const bucket = rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > rateLimitMax) {
        const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("X-RateLimit-Limit", String(rateLimitMax));
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
        return res.status(429).json({ error: "rate_limited" });
      }
    }
    const active = rateBuckets.get(key);
    if (active) {
      res.setHeader("X-RateLimit-Limit", String(rateLimitMax));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, rateLimitMax - active.count)));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(active.resetAt / 1000)));
    }
    next();
  });

  app.get("/healthz", healthz);
  app.get("/health", health);
  app.post("/webhooks/wompi", wompiWebhook);
  app.post("/webhooks/chatwoot", chatwootWebhook);

  app.get("/admin/webhook-events", requireAdminToken, listWebhookEvents);
  app.use("/admin/products", requireAdminToken, productsRouter);
  app.use("/admin/orders", requireAdminToken, ordersRouter);
  app.use("/admin/plans", requireAdminToken, plansRouter);
  app.use("/admin/customers", requireAdminToken, customersRouter);
  app.use("/admin/subscriptions", requireAdminToken, subscriptionsRouter);
  app.use("/admin/settings", requireAdminToken, settingsRouter);
  app.use("/admin/logs", requireAdminToken, logsRouter);
  app.use("/admin/notifications", requireAdminToken, notificationsRouter);
  app.use("/admin/metrics", requireAdminToken, metricsRouter);
  app.use("/admin/auth", requireAdminToken, authRouter);
  app.use("/admin/sa", requireAdminToken, superAdminRouter);
  app.use("/admin/chatwoot", requireAdminToken, chatwootRouter);
  app.use("/admin/comms", requireAdminToken, commsRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
