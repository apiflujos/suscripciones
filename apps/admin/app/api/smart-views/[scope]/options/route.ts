import { NextResponse } from "next/server";
import { getAdminApiConfig } from "../../../../lib/adminApi";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../../lib/session";

async function getSessionEmail() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  return session?.email || "";
}

export async function GET(req: Request, ctx: { params: { scope: string } }) {
  const { apiBase, token } = getAdminApiConfig();
  const scope = String(ctx.params.scope || "").trim();
  const email = await getSessionEmail();
  const url = new URL(req.url);
  const field = url.searchParams.get("field") || "";
  const res = await fetch(
    `${apiBase}/admin/smart-views/${encodeURIComponent(scope)}/options?field=${encodeURIComponent(field)}`,
    {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "x-admin-token": token, ...(email ? { "x-admin-user-email": email } : {}) }
    }
  );
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
