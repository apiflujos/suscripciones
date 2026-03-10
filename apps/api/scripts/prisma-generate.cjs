/* eslint-disable no-console */
/* Cross-platform Prisma generate with a safe default DATABASE_URL.
 *
 * We avoid `${DATABASE_URL:-...}` bash syntax so it works on Windows PowerShell/cmd.
 */

const { spawn } = require("node:child_process");

const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/postgres?schema=public";

const env = { ...process.env };
if (!String(env.DATABASE_URL || "").trim()) env.DATABASE_URL = DEFAULT_DATABASE_URL;

const prismaBin = process.platform === "win32"
  ? require.resolve("prisma/build/index.js")
  : require.resolve("prisma/build/index.js");

const child = spawn(process.execPath, [prismaBin, "generate"], { stdio: "inherit", env });

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 1 : code);
});

