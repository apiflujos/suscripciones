import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminApiConfig } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: any) {
  const { apiBase, token } = getAdminApiConfig();
  const id = String(context?.params?.id || "").trim();
  if (!id) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const url = new URL(req.url);
  const take = url.searchParams.get("take") || "50";
  const res = await fetch(`${apiBase}/admin/products/${encodeURIComponent(id)}/payments?take=${encodeURIComponent(take)}` as string, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}`, "x-admin-token": token } : {})
    },
    cache: "no-store"
  });

  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
