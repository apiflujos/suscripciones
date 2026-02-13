import "server-only";
import { normalizeToken } from "./normalizeToken";

type FetchResult = { ok: boolean; status: number; json: any };

type CacheEntry = { atMs: number; result: FetchResult };
const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 200;

function pruneCache() {
  if (cache.size <= CACHE_MAX) return;
  const entries = Array.from(cache.entries()).sort((a, b) => a[1].atMs - b[1].atMs);
  const removeCount = entries.length - CACHE_MAX;
  for (let i = 0; i < removeCount; i++) cache.delete(entries[i][0]);
}

export function getAdminApiConfig() {
  const internalBase = process.env.ADMIN_INTERNAL_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || "";
  const apiBase = internalBase || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  return { apiBase, token };
}

function cacheKey(url: string, token: string) {
  const tokenKey = token ? `t:${token.slice(-6)}` : "t:none";
  return `${tokenKey}:${url}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<FetchResult> {
  try {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: { error: "fetch_failed", detail: String((err as any)?.message || err) } };
  }
}

export async function fetchPublicCached(path: string, opts?: { ttlMs?: number }): Promise<FetchResult> {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const url = `${apiBase}${path}`;
  const ttlMs = Math.max(0, Number(opts?.ttlMs ?? 1500));
  if (ttlMs === 0) return fetchJson(url, { cache: "no-store" });

  const key = cacheKey(url, "");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.atMs < ttlMs) return hit.result;

  const result = await fetchJson(url, { cache: "no-store" });
  if (result.ok) {
    cache.set(key, { atMs: Date.now(), result });
    pruneCache();
  }
  return result;
}

export async function fetchAdminCached(path: string, opts?: { ttlMs?: number }): Promise<FetchResult> {
  const { apiBase, token } = getAdminApiConfig();
  const url = `${apiBase}${path}`;
  const ttlMs = Math.max(0, Number(opts?.ttlMs ?? 1500));

  if (!token) return { ok: false, status: 401, json: { error: "missing_admin_token" } };
  if (ttlMs === 0) {
    return fetchJson(url, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
    });
  }

  const key = cacheKey(url, token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.atMs < ttlMs) return hit.result;

  const result = await fetchJson(url, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  });

  if (result.ok) {
    cache.set(key, { atMs: Date.now(), result });
    pruneCache();
  }
  return result;
}
