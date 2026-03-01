import { NextResponse } from "next/server";
import { getAdminApiConfig } from "../../../../lib/adminApi";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../../lib/session";

type RouteContext = { params: Record<string, string | string[]> };

const getParam = (params: RouteContext["params"], key: string) => {
  const raw = params?.[key];
  return String(Array.isArray(raw) ? raw[0] : raw || "").trim();
};

async function getSessionEmail() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  return session?.email || "";
}

export async function DELETE(_: Request, ctx: RouteContext) {
  const { apiBase, token } = getAdminApiConfig();
  const scope = getParam(ctx.params, "scope");
  const id = getParam(ctx.params, "id");
  const email = await getSessionEmail();
  const res = await fetch(`${apiBase}/admin/smart-views/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token, ...(email ? { "x-admin-user-email": email } : {}) }
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}

export async function PUT(req: Request, ctx: RouteContext) {
  const { apiBase, token } = getAdminApiConfig();
  const scope = getParam(ctx.params, "scope");
  const id = getParam(ctx.params, "id");
  const email = await getSessionEmail();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${apiBase}/admin/smart-views/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-admin-token": token, ...(email ? { "x-admin-user-email": email } : {}) },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
