import "server-only";

type FetchResult = { ok: boolean; status: number; json: any };

type CacheEntry = { atMs: number; result: FetchResult };
const cache = new Map<string, CacheEntry>();

function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}

export function getAdminApiConfig() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || "");
  return { apiBase, token };
}

function cacheKey(url: string, token: string) {
  const tokenKey = token ? `t:${token.slice(-6)}` : "t:none";
  return `${tokenKey}:${url}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<FetchResult> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
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
  if (result.ok) cache.set(key, { atMs: Date.now(), result });
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

  if (result.ok) cache.set(key, { atMs: Date.now(), result });
  return result;
}

