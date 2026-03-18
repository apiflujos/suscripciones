import "server-only";

import { cookies } from "next/headers";
import { getOptionalApiBase } from "../lib/adminApi";
import { normalizeToken } from "../lib/normalizeToken";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { signJwt } from "../../lib/jwt";
import { assertSameOrigin } from "../lib/csrf";

export const SA_COOKIE = "sa_session";

export async function getSaSessionToken() {
  const c = await cookies();
  const v = c.get(SA_COOKIE)?.value || "";
  return normalizeToken(v);
}

async function getSessionJwt() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value;
  if (!sessionToken) return null;
  const session = await verifyAdminSessionToken(sessionToken);
  if (!session) return null;
  return signJwt({ sub: session.email, role: session.role as any, tenantId: session.tenantId || null });
}

async function fetchJson(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export async function saAdminFetch(path: string, init: RequestInit) {
  await assertSameOrigin();
  const apiBase = getOptionalApiBase();
  const saToken = await getSaSessionToken();
  const jwt = await getSessionJwt();
  if (!jwt) return { ok: false, status: 401, json: { error: "missing_jwt" } };
  if (!saToken) return { ok: false, status: 401, json: { error: "missing_sa_session" } };

  return fetchJson(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-sa-session": saToken,
      ...(init.headers ?? {})
    }
  });
}

export async function adminFetchNoSa(path: string, init: RequestInit) {
  await assertSameOrigin();
  const apiBase = getOptionalApiBase();
  const jwt = await getSessionJwt();
  if (!jwt) return { ok: false, status: 401, json: { error: "missing_jwt" } };
  return fetchJson(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${jwt}`,
      ...(init.headers ?? {})
    }
  });
}
