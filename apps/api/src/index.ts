import path from "path";
import next from "next";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { logger } from "./lib/logger";
import { ensureBootstrapSuperAdmin } from "./services/superAdminAuth";

async function start() {
  const env = loadEnv(process.env);
  const app = createApp();

  const isProd = process.env.NODE_ENV === "production";
  const adminDir = path.resolve(__dirname, "..", "..", "admin");
  const nextApp = next({ dev: !isProd, dir: adminDir });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  app.all("*", (req, res) => handle(req, res));

  await ensureBootstrapSuperAdmin().catch((err) => {
    logger.error({ err }, "Failed to bootstrap SUPER_ADMIN");
  });

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "API + Admin listening");
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
