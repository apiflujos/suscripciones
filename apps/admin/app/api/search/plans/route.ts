import { NextResponse } from "next/server";
import { getAdminApiConfig } from "../../../lib/adminApi";

export async function GET(req: Request) {
  const { apiBase, token } = getAdminApiConfig();
  if (!token) return NextResponse.json({ error: "missing_admin_token" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("q") || "").trim();
  const take = String(searchParams.get("take") || "80").trim();
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (take) qs.set("take", take);

  const res = await fetch(`${apiBase}/admin/plans?${qs.toString()}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  });
  const json = await res.json().catch(() => null);
  return NextResponse.json(json ?? { error: "invalid_response" }, { status: res.status });
}
