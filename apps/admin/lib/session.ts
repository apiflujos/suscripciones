export const ADMIN_SESSION_COOKIE = "admin_session";

export type AdminRole = "SUPER_ADMIN" | "ADMIN" | "AGENT";

export type AdminSession = {
  email: string;
  role: AdminRole;
  tenantId?: string | null;
  iat: number;
  exp: number;
};

function b64urlEncode(input: Uint8Array) {
  let s = "";
  for (const b of input) s += String.fromCharCode(b);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(input: string) {
  const s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const raw = atob(s + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function normalizeSecret(v: unknown) {
  return String(v || "").trim();
}

export function getSessionSecret() {
  return (
    normalizeSecret(process.env.ADMIN_SESSION_SECRET) ||
    normalizeSecret(process.env.ADMIN_SESSION_SALT) ||
    normalizeSecret(process.env.ADMIN_API_TOKEN) ||
    normalizeSecret(process.env.ADMIN_API_TOKEN) ||
    ""
  );
}

async function importHmacKey(secret: string) {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function hmacSha256(secret: string, message: string) {
  const key = await importHmacKey(secret);
  const data = new TextEncoder().encode(message);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

function safeJsonParse(input: string): any | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export async function signAdminSession(session: Omit<AdminSession, "iat" | "exp">, opts?: { ttlSeconds?: number }) {
  const secret = getSessionSecret();
  if (!secret) throw new Error("missing_admin_session_secret");

  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(60, Math.trunc(Number(opts?.ttlSeconds ?? 60 * 60 * 12)));
  const payload: AdminSession = { ...session, iat: now, exp: now + ttlSeconds };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(new TextEncoder().encode(payloadJson));
  const sig = await hmacSha256(secret, payloadB64);
  const sigB64 = b64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

export async function verifyAdminSessionToken(token: string): Promise<AdminSession | null> {
  const secret = getSessionSecret();
  if (!secret) return null;

  const t = String(token || "").trim();
  const [payloadB64, sigB64] = t.split(".");
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = await hmacSha256(secret, payloadB64);
  const gotSig = b64urlDecode(sigB64);
  if (gotSig.length !== expectedSig.length) return null;
  let ok = 1;
  for (let i = 0; i < gotSig.length; i++) ok &= gotSig[i] === expectedSig[i] ? 1 : 0;
  if (!ok) return null;

  const payloadBytes = b64urlDecode(payloadB64);
  const payloadJson = new TextDecoder().decode(payloadBytes);
  const payload = safeJsonParse(payloadJson);
  if (!payload || typeof payload !== "object") return null;

  const email = String(payload.email || "").trim();
  const role = String(payload.role || "").trim();
  const iat = Number(payload.iat);
  const exp = Number(payload.exp);
  const tenantIdRaw = payload.tenantId == null ? null : String(payload.tenantId || "").trim();

  if (!email || !role) return null;
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (exp <= Math.floor(Date.now() / 1000)) return null;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN" && role !== "AGENT") return null;

  return { email, role: role as AdminRole, tenantId: tenantIdRaw || null, iat, exp };
}
