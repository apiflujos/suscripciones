import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const token = (process.env.ADMIN_API_TOKEN || "").trim();

  const startedAt = Date.now();
  let health: { ok: boolean; status?: number; error?: string; ms?: number } = { ok: false };

  try {
    const res = await fetch(`${apiBase}/health`, { cache: "no-store" });
    const ms = Date.now() - startedAt;
    health = { ok: res.ok, status: res.status, ms };
  } catch (err: any) {
    const ms = Date.now() - startedAt;
    health = { ok: false, error: String(err?.message || err), ms };
  }

  return NextResponse.json({
    apiBase,
    hasAdminToken: !!token,
    adminTokenLength: token.length,
    health
  });
}
