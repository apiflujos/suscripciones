import { getRolePermissions, Role, Permission } from "./rbac";

export type JwtClaims = {
  sub: string;
  role: Role;
  permissions: Permission[];
  tenantId?: string | null;
  iss: string;
  aud: string;
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

function getEnv(name: string, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

export function getJwtConfig() {
  const secret = getEnv("JWT_SECRET");
  const issuer = getEnv("JWT_ISSUER", "suscripciones");
  const audience = getEnv("JWT_AUDIENCE", "admin");
  const ttlSeconds = Math.max(60, Math.trunc(Number(getEnv("JWT_TTL_SECONDS", "1800")) || 1800));
  return { secret, issuer, audience, ttlSeconds };
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

export async function signJwt(
  payload: Omit<JwtClaims, "iat" | "exp" | "permissions" | "iss" | "aud"> & { permissions?: Permission[] },
  opts?: { ttlSeconds?: number; issuer?: string; audience?: string }
) {
  const { secret, issuer, audience, ttlSeconds: defaultTtl } = getJwtConfig();
  if (!secret) throw new Error("missing_jwt_secret");

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.trunc(Number(opts?.ttlSeconds ?? defaultTtl)));
  const permissions = payload.permissions && payload.permissions.length ? payload.permissions : getRolePermissions(payload.role);
  const claims: JwtClaims = {
    ...payload,
    permissions,
    iss: opts?.issuer || issuer,
    aud: opts?.audience || audience,
    iat: now,
    exp: now + ttl
  };

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const toSign = `${headerB64}.${payloadB64}`;
  const sig = await hmacSha256(secret, toSign);
  const sigB64 = b64urlEncode(sig);
  return `${toSign}.${sigB64}`;
}

export async function verifyJwt(token: string, opts?: { issuer?: string; audience?: string }): Promise<JwtClaims | null> {
  const { secret, issuer, audience } = getJwtConfig();
  if (!secret) return null;
  const t = String(token || "").trim();
  const parts = t.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  const expected = await hmacSha256(secret, `${headerB64}.${payloadB64}`);
  const got = b64urlDecode(sigB64);
  if (got.length !== expected.length) return null;
  let ok = 1;
  for (let i = 0; i < got.length; i++) ok &= got[i] === expected[i] ? 1 : 0;
  if (!ok) return null;

  const payloadJson = new TextDecoder().decode(b64urlDecode(payloadB64));
  let payload: any = null;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.iss !== (opts?.issuer || issuer) || payload.aud !== (opts?.audience || audience)) return null;
  if (!payload.sub || !payload.role || !payload.iat || !payload.exp) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload as JwtClaims;
}

export function normalizeBearer(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.toLowerCase().startsWith("bearer ")) return v.slice(7).trim();
  return v;
}
