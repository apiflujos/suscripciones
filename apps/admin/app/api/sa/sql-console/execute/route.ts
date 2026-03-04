import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminApiConfig } from "../../../../lib/adminApi";
import { normalizeToken } from "../../../../lib/normalizeToken";
import { SA_COOKIE } from "../../../../__sa/saApi";

export async function POST(req: Request) {
  const { apiBase } = getAdminApiConfig();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return NextResponse.json({ error: "missing_admin_token" }, { status: 401 });

  const c = await cookies();
  const saToken = normalizeToken(c.get(SA_COOKIE)?.value || "");
  if (!saToken) return NextResponse.json({ error: "missing_sa_session" }, { status: 401 });

  const body = await req.text();
  const res = await fetch(`${apiBase}/admin/sa/sql-console/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "x-sa-session": saToken
    },
    body
  });
  const json = await res.json().catch(() => ({ error: "invalid_response" }));
  return NextResponse.json(json, { status: res.status });
}
