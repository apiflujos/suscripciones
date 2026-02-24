import path from "path";
import { spawn } from "node:child_process";
import next from "next";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { logger } from "./lib/logger";
import { ensureBootstrapSuperAdmin } from "./services/superAdminAuth";
import { prisma } from "./db/prisma";

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

  await maybeRunApiflujosImport(env.PORT).catch((err) => {
    logger.error({ err }, "Failed to run APIFLUJOS import");
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});

async function maybeRunApiflujosImport(port: number) {
  const enabled = String(process.env.IMPORT_APIFLUJOS_ON_BOOT || "").trim() === "1";
  if (!enabled) return;

  const existing = await prisma.systemLog.findFirst({
    where: { source: "import.apiflujos", message: "completed" },
    orderBy: { createdAt: "desc" }
  });
  if (existing) {
    logger.info("APIFLUJOS import already completed; skipping");
    return;
  }

  const csvPath =
    process.env.IMPORT_APIFLUJOS_CSV_PATH ||
    path.resolve(process.cwd(), "Base de datos APIFLUJOS - Sheet1.csv");
  const scriptPath = path.resolve(process.cwd(), "src", "scripts", "import-apiflujos.js");
  const apiBase = process.env.API_BASE_URL || `http://localhost:${port}`;

  logger.info({ csvPath }, "Starting APIFLUJOS import");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        API_BASE_URL: apiBase,
        CSV_PATH: csvPath,
        DELETE_CSV: "1"
      },
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", async (code) => {
      if (code === 0) {
        await prisma.systemLog
          .create({
            data: {
              level: "INFO",
              source: "import.apiflujos",
              message: "completed",
              context: { csvPath }
            } as any
          })
          .catch(() => {});
        resolve();
      } else {
        reject(new Error(`import_exit_${code}`));
      }
    });
  });
}
