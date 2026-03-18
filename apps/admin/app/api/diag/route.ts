import { NextResponse } from "next/server";
import { requireApiSession } from "../_lib/requireApiSession";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  let health: { ok: boolean; status?: number; error?: string; ms?: number } = { ok: false };

  try {
    const healthUrl = new URL("/health", req.url);
    const res = await fetch(healthUrl, { cache: "no-store" });
    const ms = Date.now() - startedAt;
    health = { ok: res.ok, status: res.status, ms };
  } catch (err: any) {
    const ms = Date.now() - startedAt;
    health = { ok: false, error: String(err?.message || err), ms };
  }

  return NextResponse.json({ health });
}
