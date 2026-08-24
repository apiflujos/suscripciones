"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCredential = getCredential;
exports.getCredentialsBulk = getCredentialsBulk;
exports.setCredential = setCredential;
exports.clearCredential = clearCredential;
const prisma_1 = require("../db/prisma");
const crypto_1 = require("../lib/crypto");
function keyFromEnv() {
    const b64 = (process.env.CREDENTIALS_ENCRYPTION_KEY_B64 || "").trim();
    if (!b64)
        return null;
    let buf;
    try {
        buf = Buffer.from(b64, "base64");
    }
    catch {
        return null;
    }
    if (buf.length !== 32)
        return null;
    return buf;
}
const cache = new Map();
const CACHE_TTL_MS = 30_000;
function cacheKey(provider, key) {
    return `${provider}:${key}`;
}
async function getCredential(provider, key) {
    const ck = cacheKey(provider, key);
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.cachedAtMs < CACHE_TTL_MS)
        return hit.value;
    const row = await prisma_1.prisma.credential.findUnique({ where: { provider_key: { provider, key } } });
    if (!row || !row.active)
        return undefined;
    const encKey = keyFromEnv();
    if (!encKey)
        return undefined;
    const value = (0, crypto_1.decryptAes256Gcm)(row.valueEncrypted, encKey);
    cache.set(ck, { value, cachedAtMs: Date.now() });
    return value;
}
async function getCredentialsBulk(provider, keys) {
    const uniqueKeys = Array.from(new Set(keys.map((k) => String(k || "").trim()).filter(Boolean)));
    const out = new Map();
    if (uniqueKeys.length === 0)
        return out;
    const encKey = keyFromEnv();
    if (!encKey)
        return out;
    const rows = await prisma_1.prisma.credential.findMany({
        where: { provider, active: true, key: { in: uniqueKeys } },
        select: { key: true, valueEncrypted: true }
    });
    for (const r of rows) {
        try {
            const value = (0, crypto_1.decryptAes256Gcm)(r.valueEncrypted, encKey);
            out.set(r.key, value);
            cache.set(cacheKey(provider, r.key), { value, cachedAtMs: Date.now() });
        }
        catch {
            // ignore decrypt errors for individual keys
        }
    }
    return out;
}
async function setCredential(provider, key, plaintext) {
    const encKey = keyFromEnv();
    if (!encKey) {
        throw new Error("CREDENTIALS_ENCRYPTION_KEY_B64 not configured (must be base64-encoded 32 bytes)");
    }
    const valueEncrypted = (0, crypto_1.encryptAes256Gcm)(plaintext, encKey);
    await prisma_1.prisma.credential.upsert({
        where: { provider_key: { provider, key } },
        create: { provider, key, valueEncrypted, active: true },
        update: { valueEncrypted, active: true }
    });
    cache.delete(cacheKey(provider, key));
}
async function clearCredential(provider, key) {
    await prisma_1.prisma.credential.update({
        where: { provider_key: { provider, key } },
        data: { active: false }
    });
    cache.delete(cacheKey(provider, key));
}
