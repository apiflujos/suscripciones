export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness probe (no external dependencies)
export async function GET() {
  return Response.json({ ok: true });
}
