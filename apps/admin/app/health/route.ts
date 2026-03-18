export async function GET() {
  return Response.json({ ok: true, status: "up" }, { status: 200 });
}
