import "server-only";
import { cookies } from "next/headers";
import { normalizeToken } from "./normalizeToken";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";

type FetchResult = { ok: boolean; status: number; json: any };

type CacheEntry = { atMs: number; result: FetchResult };
const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 200;
const FETCH_TIMEOUT_MS = 12_000;

function pruneCache() {
  if (cache.size <= CACHE_MAX) return;
  const entries = Array.from(cache.entries()).sort((a, b) => a[1].atMs - b[1].atMs);
  const removeCount = entries.length - CACHE_MAX;
  for (let i = 0; i < removeCount; i++) cache.delete(entries[i][0]);
}

export function getAdminApiConfig() {
  const apiBase = getOptionalApiBase();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN);
  return { apiBase, token };
}

async function getSessionEmail(): Promise<string | null> {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value;
  if (!sessionToken) return null;
  const session = await verifyAdminSessionToken(sessionToken);
  return session?.email ?? null;
}

export function getRequiredApiBase() {
  const apiBase = getOptionalApiBase();
  if (!apiBase) {
    throw new Error("missing_next_public_api_base_url");
  }
  return apiBase;
}

export function getOptionalApiBase() {
  const internalBase = process.env.ADMIN_INTERNAL_API_BASE_URL ?? process.env.INTERNAL_API_BASE_URL;
  const publicBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  return (internalBase ?? publicBase ?? "").trim();
}

function cacheKey(url: string, token: string) {
  const tokenKey = token ? `t:${token.slice(-6)}` : "t:none";
  return `${tokenKey}:${url}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const json = await res.json();
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = msg.toLowerCase().includes("abort");
    return { ok: false, status: 0, json: { error: isAbort ? "fetch_timeout" : "fetch_failed", detail: msg } };
  } finally {
    clearTimeout(timeoutId);
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
  const sessionEmail = await getSessionEmail();

  if (!token) return { ok: false, status: 401, json: { error: "missing_admin_token" } };
  if (ttlMs === 0) {
    return fetchJson(url, {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "x-admin-token": token,
        ...(sessionEmail ? { "x-admin-user-email": sessionEmail } : {})
      }
    });
  }

  const key = cacheKey(url, token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.atMs < ttlMs) return hit.result;

  let result = await fetchJson(url, {
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      ...(sessionEmail ? { "x-admin-user-email": sessionEmail } : {})
    }
  });
  if (!result.ok && shouldRetryStatus(result.status)) {
    await waitMs(1200);
    result = await fetchJson(url, {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "x-admin-token": token,
        ...(sessionEmail ? { "x-admin-user-email": sessionEmail } : {})
      }
    });
  }

  if (result.ok) {
    cache.set(key, { atMs: Date.now(), result });
    pruneCache();
  }
  return result;
}
