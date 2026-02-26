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
  const apiBase = getOptionalApiBase();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  return { apiBase, token };
}

export function getRequiredApiBase() {
  const apiBase = getOptionalApiBase();
  if (!apiBase) {
    throw new Error("missing_next_public_api_base_url");
  }
  return apiBase;
}

export function getOptionalApiBase() {
  const internalBase = process.env.ADMIN_INTERNAL_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || "";
  const publicBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  return (internalBase || publicBase).trim();
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

function shouldRetryStatus(status: number) {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPublicCached(path: string, opts?: { ttlMs?: number }): Promise<FetchResult> {
  const apiBase = getOptionalApiBase();
  if (!apiBase) return { ok: false, status: 500, json: { error: "missing_api_base" } };
  const url = `${apiBase}${path}`;
  const ttlMs = Math.max(0, Number(opts?.ttlMs ?? 1500));
  if (ttlMs === 0) return fetchJson(url, { cache: "no-store" });

  const key = cacheKey(url, "");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.atMs < ttlMs) return hit.result;

  let result = await fetchJson(url, { cache: "no-store" });
  if (!result.ok && shouldRetryStatus(result.status)) {
    await waitMs(1200);
    result = await fetchJson(url, { cache: "no-store" });
  }
  if (result.ok) {
    cache.set(key, { atMs: Date.now(), result });
    pruneCache();
  }
  return result;
}

export async function fetchAdminCached(path: string, opts?: { ttlMs?: number }): Promise<FetchResult> {
  const { apiBase, token } = getAdminApiConfig();
  if (!apiBase) return { ok: false, status: 500, json: { error: "missing_api_base" } };
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

  let result = await fetchJson(url, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  });
  if (!result.ok && shouldRetryStatus(result.status)) {
    await waitMs(1200);
    result = await fetchJson(url, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
    });
  }

  if (result.ok) {
    cache.set(key, { atMs: Date.now(), result });
    pruneCache();
  }
  return result;
}
