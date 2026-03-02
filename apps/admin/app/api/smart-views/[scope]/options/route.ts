import { NextResponse } from "next/server";
import { getAdminApiConfig } from "../../../../lib/adminApi";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../../lib/session";

type RouteContext = { params: Promise<{ scope: string }> };

const getParam = async (paramsPromise: RouteContext["params"], key: "scope") => {
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

export async function GET(req: Request, ctx: RouteContext) {
  const { apiBase, token } = getAdminApiConfig();
  const scope = await getParam(ctx.params, "scope");
  const { email, tenantId } = await getSessionContext();
  const url = new URL(req.url);
  const field = url.searchParams.get("field") || "";
  const res = await fetch(
    `${apiBase}/admin/smart-views/${encodeURIComponent(scope)}/options?field=${encodeURIComponent(field)}`,
    {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "x-admin-token": token,
        ...(email ? { "x-admin-user-email": email } : {}),
        ...(tenantId ? { "x-tenant-id": tenantId } : {})
      }
    }
  );
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
