import { NextResponse } from "next/server";
import { getAdminApiConfig } from "../../../../lib/adminApi";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../../lib/session";

type RouteContext = { params: Promise<{ scope: string; id: string }> };

const getParam = async (paramsPromise: RouteContext["params"], key: "scope" | "id") => {
  const params = await paramsPromise;
  const raw = params?.[key] || "";
  return String(raw).trim();
};

async function getSessionContext() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  return { email: session?.email || "", tenantId: session?.tenantId || "" };
}

export async function DELETE(_: Request, ctx: RouteContext) {
  const { apiBase, token } = getAdminApiConfig();
  const scope = await getParam(ctx.params, "scope");
  const id = await getParam(ctx.params, "id");
  const { email, tenantId } = await getSessionContext();
  const res = await fetch(`${apiBase}/admin/smart-views/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      ...(email ? { "x-admin-user-email": email } : {}),
      ...(tenantId ? { "x-tenant-id": tenantId } : {})
    }
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}

export async function PUT(req: Request, ctx: RouteContext) {
  const { apiBase, token } = getAdminApiConfig();
  const scope = await getParam(ctx.params, "scope");
  const id = await getParam(ctx.params, "id");
  const { email, tenantId } = await getSessionContext();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${apiBase}/admin/smart-views/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      ...(email ? { "x-admin-user-email": email } : {}),
      ...(tenantId ? { "x-tenant-id": tenantId } : {})
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
