import { NextResponse } from "next/server";
import { normalizeToken } from "../../../lib/normalizeToken";
import { getRequiredApiBase } from "../../../lib/adminApi";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return NextResponse.json({ ok: false, error: "missing_admin_token" }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const limit = Number(body?.limit || 200);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 2000) : 200;
  const apiBase = getRequiredApiBase();

  const res = await fetch(`${apiBase}/admin/comms/sync-attributes?limit=${encodeURIComponent(safeLimit)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: json?.error || "sync_failed" }, { status: res.status });
  }
  return NextResponse.json({
    ok: true,
    module: String(json?.module || "sincronizacion_contactos"),
    platform: String(json?.platform || "Chatwoot"),
    sourceLabel: String(json?.sourceLabel || "Contactos de ApiFlujos"),
    targetLabel: String(json?.targetLabel || "Contactos y atributos en Chatwoot"),
    startedAt: String(json?.startedAt || ""),
    finishedAt: String(json?.finishedAt || ""),
    synced: Number(json?.synced || 0),
    failed: Number(json?.failed || 0),
    skipped: Number(json?.skipped || 0),
    processed: Number(json?.processed || (Number(json?.synced || 0) + Number(json?.failed || 0))),
    limit: Number(json?.limit || safeLimit),
    errors: Array.isArray(json?.errors) ? json.errors : []
  });
}
