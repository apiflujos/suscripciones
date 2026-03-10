/* eslint-disable no-console */
/* Cross-platform Next runner.
 *
 * We intentionally avoid `sh -c 'PORT=${PORT:-3000} ...'` because it breaks in Windows PowerShell.
 * Usage:
 *   node scripts/run-next.cjs dev
 *   node scripts/run-next.cjs start
 */

const { spawn } = require("node:child_process");

function getArg(name, fallback) {
  const v = String(process.env[name] || "").trim();
  return v.length ? v : fallback;
}

const cmd = String(process.argv[2] || "").trim();
if (!cmd || (cmd !== "dev" && cmd !== "start")) {
  console.error("Usage: node scripts/run-next.cjs <dev|start>");
  process.exit(1);
}

const port = getArg("PORT", "3000");
const host = getArg("HOST", cmd === "dev" ? "127.0.0.1" : "0.0.0.0");

const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, cmd, "-H", host, "-p", port], {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 1 : code);
});

