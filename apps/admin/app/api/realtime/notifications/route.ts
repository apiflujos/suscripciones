import { NextRequest } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiSession(req);
    if (!auth.ok) return auth.response;

    const searchParams = req.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "5", 10);

    // Obtener notificaciones del localStorage del servidor (simulado)
    // En producción, esto debería venir de una base de datos o cola de mensajes
    const notifications: any[] = [];

    return new Response(JSON.stringify({ notifications }), {
      status: 200,
      headers: { 
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate"
      }
    });
  } catch (error) {
    console.error("Error in realtime notifications:", error);
    return new Response(JSON.stringify({ notifications: [], error: "Internal error" }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;
  if (!auth.session.permissions.includes("notifications:write")) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const payload = body?.payload ?? {};
  const { publishToChannel } = await import("../../../../lib/wsHub");
  const delivered = publishToChannel("notifications", payload);

  return new Response(JSON.stringify({ ok: true, delivered }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
