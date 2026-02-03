import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { health } from "./routes/health";
import { requireAdminToken, listWebhookEvents } from "./routes/admin";
import { wompiWebhook } from "./routes/webhooksWompi";
import { plansRouter } from "./routes/plans";
import { customersRouter } from "./routes/customers";
import { subscriptionsRouter } from "./routes/subscriptions";

export function createApp() {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", health);
  app.post("/webhooks/wompi", wompiWebhook);

  app.get("/admin/webhook-events", requireAdminToken, listWebhookEvents);
  app.use("/admin/plans", requireAdminToken, plansRouter);
  app.use("/admin/customers", requireAdminToken, customersRouter);
  app.use("/admin/subscriptions", requireAdminToken, subscriptionsRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
