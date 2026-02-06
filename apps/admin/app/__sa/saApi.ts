import "server-only";

import { cookies } from "next/headers";
import { getAdminApiConfig } from "../lib/adminApi";

export const SA_COOKIE = "sa_session";

function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}

export function getSaSessionToken() {
  const v = cookies().get(SA_COOKIE)?.value || "";
  return normalizeToken(v);
}

async function fetchJson(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export async function saAdminFetch(path: string, init: RequestInit) {
  const { apiBase, token } = getAdminApiConfig();
  const saToken = getSaSessionToken();
  if (!token) return { ok: false, status: 401, json: { error: "missing_admin_token" } };
  if (!saToken) return { ok: false, status: 401, json: { error: "missing_sa_session" } };

  return fetchJson(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "x-sa-session": saToken,
      ...(init.headers ?? {})
    }
  });
}

export async function adminFetchNoSa(path: string, init: RequestInit) {
  const { apiBase, token } = getAdminApiConfig();
  if (!token) return { ok: false, status: 401, json: { error: "missing_admin_token" } };
  return fetchJson(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      ...(init.headers ?? {})
    }
  });
}

