// Realtime COMPLETAMENTE desactivado para mejorar rendimiento
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Retornar vacío inmediatamente - realtime desactivado
  return new Response(JSON.stringify({ events: [], serverTime: new Date().toISOString(), disabled: true }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
