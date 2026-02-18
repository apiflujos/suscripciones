import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const token = (process.env.ADMIN_API_TOKEN || "").trim();
  const id = String(params.id || "").trim();
  if (!id) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const url = new URL(req.url);
  const take = url.searchParams.get("take") || "50";
  const res = await fetch(`${apiBase}/admin/customers/${encodeURIComponent(id)}/payments?take=${encodeURIComponent(take)}` as string, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}`, "x-admin-token": token } : {})
    },
    cache: "no-store"
  });

  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
