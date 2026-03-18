/* eslint-disable no-console */
/* Cross-platform Next runner.
 *
 * We intentionally avoid `sh -c 'PORT=${PORT:-3000} ...'` because it breaks in Windows PowerShell.
 * Usage:
 *   node scripts/run-next.cjs dev
 *   node scripts/run-next.cjs start
 */

const http = require("node:http");
const url = require("node:url");
const crypto = require("node:crypto");
const next = require("next");
const { WebSocketServer } = require("ws");
const { PrismaClient } = require("@prisma/client");
const { setWsHub } = require("../lib/wsHub");

function getArg(name, fallback) {
  const v = String(process.env[name] || "").trim();
  return v.length ? v : fallback;
}

const cmd = String(process.argv[2] || "").trim();
if (!cmd || (cmd !== "dev" && cmd !== "start")) {
  console.error("Usage: node scripts/run-next.cjs <dev|start>");
  process.exit(1);
}

const port = getArg("PORT", "3002");
const host = getArg("HOST", cmd === "dev" ? "127.0.0.1" : "0.0.0.0");

const dev = cmd === "dev";
const app = next({ dev, hostname: host, port: Number(port) });
const handle = app.getRequestHandler();
const prisma = new PrismaClient();

function getJwtConfig() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  const issuer = String(process.env.JWT_ISSUER || "suscripciones").trim();
  const audience = String(process.env.JWT_AUDIENCE || "admin").trim();
  return { secret, issuer, audience };
}

function base64UrlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64");
}

function verifyJwt(token) {
  const { secret, issuer, audience } = getJwtConfig();
  if (!secret) return null;
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${headerB64}.${payloadB64}`);
  const expected = hmac.digest("base64url");
  if (!sigB64 || expected !== sigB64) return null;
  let payload = null;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.iss !== issuer || payload.aud !== audience) return null;
  if (!payload.sub || !payload.role || !payload.exp) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function tokenHash(token) {
  if (!token) return null;
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function auditLog(level, message, context, actor) {
  try {
    await prisma.systemLog.create({
      data: {
        level,
        source: "ws",
        message,
        context: context || null,
        actor: actor || null
      }
    });
  } catch {
    // Do not crash on audit failures
  }
}

const channelPermissions = {
  notifications: ["notifications:read"],
  payments: ["payments:read"],
  logs: ["audit:read"],
  webhooks: ["webhook:receive"],
  jobs: ["logs:read"]
};

function hasPermissions(required, granted) {
  if (!required || required.length === 0) return true;
  if (!Array.isArray(granted)) return false;
  return required.every((p) => granted.includes(p));
}

function parseToken(req) {
  const auth = String(req.headers["authorization"] || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const u = url.parse(req.url || "", true);
  return String(u.query.token || u.query.access_token || "");
}

app.prepare().then(() => {
  const server = http.createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true });
  setWsHub({ wss });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) return socket.destroy();
    const token = parseToken(req);
    const claims = verifyJwt(token);
    if (!claims) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.claims = claims;
      ws.tokenHash = tokenHash(token);
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
    const actor = ws.claims?.sub || null;
    const perms = ws.claims?.permissions || [];
    ws.subscriptions = new Set();

    auditLog("INFO", "ws_connected", { ip, tokenHash: ws.tokenHash }, actor);

    ws.on("message", (data) => {
      let msg = null;
      try {
        msg = JSON.parse(String(data || ""));
      } catch {
        ws.send(JSON.stringify({ ok: false, error: "invalid_json" }));
        return;
      }
      const action = String(msg.action || "").trim();
      if (action === "ping") {
        ws.send(JSON.stringify({ ok: true, action: "pong", ts: Date.now() }));
        return;
      }
      if (action === "subscribe") {
        const channel = String(msg.channel || "").trim();
        if (!channel) return ws.send(JSON.stringify({ ok: false, error: "missing_channel" }));
        const required = channelPermissions[channel] || [];
        if (!hasPermissions(required, perms)) {
          ws.send(JSON.stringify({ ok: false, error: "forbidden", channel }));
          auditLog("WARN", "ws_subscribe_forbidden", { channel, ip, tokenHash: ws.tokenHash }, actor);
          return;
        }
        ws.subscriptions.add(channel);
        ws.send(JSON.stringify({ ok: true, action: "subscribed", channel }));
        auditLog("INFO", "ws_subscribed", { channel, ip, tokenHash: ws.tokenHash }, actor);
        return;
      }
      ws.send(JSON.stringify({ ok: false, error: "unsupported_action" }));
    });

    ws.on("close", () => {
      auditLog("INFO", "ws_disconnected", { ip, tokenHash: ws.tokenHash }, actor);
    });
  });

  server.listen(Number(port), host, () => {
    console.log(`> Ready on http://${host}:${port}`);
    console.log(`> WS on ws://${host}:${port}/ws`);
  });
});
