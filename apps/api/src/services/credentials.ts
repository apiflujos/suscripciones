import { CredentialProvider } from "@prisma/client";
import { prisma } from "../db/prisma";
import { decryptAes256Gcm, encryptAes256Gcm } from "../lib/crypto";

function keyFromEnv(): Buffer | null {
  const b64 = (process.env.CREDENTIALS_ENCRYPTION_KEY_B64 || "").trim();
  if (!b64) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (buf.length !== 32) return null;
  return buf;
}

type CacheEntry = { value: string; cachedAtMs: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function cacheKey(provider: CredentialProvider, key: string) {
  return `${provider}:${key}`;
}

export async function getCredential(provider: CredentialProvider, key: string): Promise<string | undefined> {
  const ck = cacheKey(provider, key);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.cachedAtMs < CACHE_TTL_MS) return hit.value;

  const row = await prisma.credential.findUnique({ where: { provider_key: { provider, key } } });
  if (!row || !row.active) return undefined;

  const encKey = keyFromEnv();
  if (!encKey) return undefined;

  const value = decryptAes256Gcm(row.valueEncrypted, encKey);
  cache.set(ck, { value, cachedAtMs: Date.now() });
  return value;
}

export async function getCredentialsBulk(provider: CredentialProvider, keys: string[]): Promise<Map<string, string>> {
  const uniqueKeys = Array.from(new Set(keys.map((k) => String(k || "").trim()).filter(Boolean)));
  const out = new Map<string, string>();
  if (uniqueKeys.length === 0) return out;

  const encKey = keyFromEnv();
  if (!encKey) return out;

  const rows = await prisma.credential.findMany({
    where: { provider, active: true, key: { in: uniqueKeys } },
    select: { key: true, valueEncrypted: true }
  });

  for (const r of rows) {
    try {
      const value = decryptAes256Gcm(r.valueEncrypted, encKey);
      out.set(r.key, value);
      cache.set(cacheKey(provider, r.key), { value, cachedAtMs: Date.now() });
    } catch {
      // ignore decrypt errors for individual keys
    }
  }

  return out;
}

export async function setCredential(provider: CredentialProvider, key: string, plaintext: string): Promise<void> {
  const encKey = keyFromEnv();
  if (!encKey) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY_B64 not configured (must be base64-encoded 32 bytes)");
  }

  const valueEncrypted = encryptAes256Gcm(plaintext, encKey);
  await prisma.credential.upsert({
    where: { provider_key: { provider, key } },
    create: { provider, key, valueEncrypted, active: true },
    update: { valueEncrypted, active: true }
  });
  cache.delete(cacheKey(provider, key));
}

export async function clearCredential(provider: CredentialProvider, key: string): Promise<void> {
  await prisma.credential.update({
    where: { provider_key: { provider, key } },
    data: { active: false }
  });
  cache.delete(cacheKey(provider, key));
}
