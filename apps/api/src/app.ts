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
import { reportsRouter } from "./routes/reports";
import { superAdminRouter } from "./routes/superAdmin";
import { authRouter } from "./routes/auth";
import { chatwootRouter } from "./routes/chatwoot";
import { chatwootWebhook } from "./routes/webhooksChatwoot";
import { commsRouter } from "./routes/comms";
import { publicTokenizationRouter } from "./routes/publicTokenization";
import { publicCartRouter } from "./routes/publicCart";
import { publicLinksRouter } from "./routes/publicLinks";
import { checkoutTemplatesRouter } from "./routes/checkoutTemplates";
import { tenantsRouter } from "./routes/tenants";
import { paymentsRouter } from "./routes/payments";
import { mediaRouter } from "./routes/media";
import { getMediaDir } from "./services/mediaStorage";
import { aiRouter } from "./routes/ai";

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === "production";
  const trustProxyRaw = String(process.env.TRUST_PROXY || "").trim();
  const trustProxy = trustProxyRaw ? trustProxyRaw : isProd ? 1 : true;
  app.set("trust proxy", trustProxy);

  app.use(pinoHttp({ logger }));
  const apiPrefixes = ["/admin", "/webhooks", "/public", "/health", "/healthz"];
  const isApiPath = (path: string) => apiPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  const allowUnsafeInline = String(process.env.CSP_ALLOW_UNSAFE_INLINE || "").trim() === "1" && !isProd;
  const scriptSrc = ["'self'", "https://checkout.wompi.co", ...(allowUnsafeInline ? ["'unsafe-inline'"] : [])];
  const styleSrc = ["'self'", "https://fonts.googleapis.com", ...(allowUnsafeInline ? ["'unsafe-inline'"] : [])];
  const helmetMw = helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "img-src": ["'self'", "data:", "https:"],
        "script-src": scriptSrc,
        "style-src": styleSrc,
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "frame-src": ["'self'", "https://checkout.wompi.co"],
        "child-src": ["'self'", "https://checkout.wompi.co"],
        "connect-src": ["'self'", "https://api.wompi.co", "https://sandbox.wompi.co", "https://production.wompi.co"]
      }
    }
  });

  const publicHelmetMw = helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "img-src": ["'self'", "data:", "https:"],
        "script-src": scriptSrc,
        "style-src": styleSrc,
        "style-src-elem": styleSrc,
        "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
        "frame-src": ["'self'", "https://checkout.wompi.co"],
        "child-src": ["'self'", "https://checkout.wompi.co"],
        "connect-src": ["'self'", "https://api.wompi.co", "https://sandbox.wompi.co", "https://production.wompi.co"]
      }
    }
  });
  app.use((req, res, next) => {
    if (!isApiPath(req.path)) return next();
    if (req.path === "/public" || req.path.startsWith("/public/")) {
      return publicHelmetMw(req, res, next);
    }
    return helmetMw(req, res, next);
  });

  app.use("/public/media", express.static(getMediaDir(), { maxAge: "30d", fallthrough: true }));

  const corsOriginsRaw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "";
  const corsOrigins = corsOriginsRaw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const corsMw = cors(
    corsOrigins.length
      ? { origin: corsOrigins, credentials: true }
      : isProd
        ? { origin: false }
        : { origin: true }
  );
  app.use((req, res, next) => (isApiPath(req.path) ? corsMw(req, res, next) : next()));

  const jsonMw = express.json({ limit: "4mb" });
  app.use((req, res, next) => (isApiPath(req.path) ? jsonMw(req, res, next) : next()));

  const rateLimitWindowMs = Math.max(10_000, Number(process.env.RATE_LIMIT_WINDOW_MS || 600_000));
  const rateLimitMax = Math.max(10, Number(process.env.RATE_LIMIT_MAX || 10000));
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  let rateRequests = 0;
  app.use((req, res, next) => {
    if (!isApiPath(req.path)) return next();
    // 1. Bypass TOTAL para health checks y monitoreo (HEAD)
    const isHealth = req.path === "/health" || req.path === "/healthz" || req.path === "/health/";
    if (isHealth || req.method === "HEAD") return next();

    // 2. Bypass para el Admin (comparando token de env)
    const authHeader = req.header("authorization") || "";
    const adminTokenHeader = req.header("x-admin-token") || "";
    const providedToken = adminTokenHeader || (authHeader.startsWith("Bearer ") ? authHeader.substring(7) : "");
    
    const isAdmin = providedToken && providedToken === process.env.ADMIN_API_TOKEN;
    if (isAdmin) return next();
    
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
  app.use("/public", publicTokenizationRouter);
  app.use("/public", publicCartRouter);
  app.use("/public", publicLinksRouter);

  app.get("/admin/webhook-events", requireAdminToken, listWebhookEvents);
  app.use("/admin/products", requireAdminToken, productsRouter);
  app.use("/admin/orders", requireAdminToken, ordersRouter);
  app.use("/admin/media", requireAdminToken, mediaRouter);
  app.use("/admin/plans", requireAdminToken, plansRouter);
  app.use("/admin/customers", requireAdminToken, customersRouter);
  app.use("/admin/subscriptions", requireAdminToken, subscriptionsRouter);
  app.use("/admin/payments", requireAdminToken, paymentsRouter);
  app.use("/admin/settings", requireAdminToken, settingsRouter);
  app.use("/admin/logs", requireAdminToken, logsRouter);
  app.use("/admin/notifications", requireAdminToken, notificationsRouter);
  app.use("/admin/metrics", requireAdminToken, metricsRouter);
  app.use("/admin/reports", requireAdminToken, reportsRouter);
  app.use("/admin/ai", requireAdminToken, aiRouter);
  app.use("/admin/auth", requireAdminToken, authRouter);
  app.use("/admin/sa", requireAdminToken, superAdminRouter);
  app.use("/admin/chatwoot", requireAdminToken, chatwootRouter);
  app.use("/admin/comms", requireAdminToken, commsRouter);
  app.use("/admin/checkout-templates", requireAdminToken, checkoutTemplatesRouter);
  app.use("/admin/tenants", requireAdminToken, tenantsRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
