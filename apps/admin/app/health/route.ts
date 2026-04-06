export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, status: "up", service: "admin" }, { status: 200 });
}
