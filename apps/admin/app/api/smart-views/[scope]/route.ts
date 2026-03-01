import { NextResponse } from "next/server";
import { getAdminApiConfig } from "../../../lib/adminApi";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/session";

type RouteContext = { params: Promise<{ scope: string }> };

const getParam = async (paramsPromise: RouteContext["params"], key: "scope") => {
  const params = await paramsPromise;
  const raw = params?.[key] || "";
  return String(raw).trim();
};

async function getSessionEmail() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  return session?.email || "";
}

export async function GET(_: Request, ctx: RouteContext) {
  const { apiBase, token } = getAdminApiConfig();
  const scope = await getParam(ctx.params, "scope");
  const email = await getSessionEmail();
  const url = `${apiBase}/admin/smart-views/${encodeURIComponent(scope)}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token, ...(email ? { "x-admin-user-email": email } : {}) }
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}

export async function POST(req: Request, ctx: RouteContext) {
  const { apiBase, token } = getAdminApiConfig();
  const scope = await getParam(ctx.params, "scope");
  const body = await req.json().catch(() => ({}));
  const email = await getSessionEmail();
  const res = await fetch(`${apiBase}/admin/smart-views/${encodeURIComponent(scope)}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-admin-token": token, ...(email ? { "x-admin-user-email": email } : {}) },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
