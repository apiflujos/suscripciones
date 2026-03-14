import { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/session";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value || "";
    const session = await verifyAdminSessionToken(sessionToken);
    
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ notifications: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const searchParams = req.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "5", 10);

    // Obtener notificaciones del localStorage del servidor (simulado)
    // En producción, esto debería venir de una base de datos o cola de mensajes
    const notifications = [];

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
