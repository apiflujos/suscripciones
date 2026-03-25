import { NextRequest } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { sendChatwootMessageForCustomer } from "../../../admin/_services/chatwoot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/customers/send-message
 * Envía un mensaje personalizado a un contacto por WhatsApp
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const { customerId, content } = body ?? {};
  if (!customerId || !content) {
    return new Response(JSON.stringify({ error: "missing_required_fields", required: ["customerId", "content"] }), { status: 400 });
  }

  const result = await sendChatwootMessageForCustomer({
    customerId: String(customerId),
    content: String(content),
    actor: auth.session.sub,
    type: "PAYMENT_LINK" // Tipo genérico para mensajes personalizados
  });

  // Respuesta con detalles para la UI
  if (result.ok && result.sent) {
    return new Response(
      JSON.stringify({
        ok: true,
        sent: true,
        messageId: result.messageId,
        message: "Mensaje enviado correctamente"
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }

  // Error al enviar
  return new Response(
    JSON.stringify({
      ok: false,
      error: result.error || "send_failed",
      details: result.details,
      messageId: result.messageId,
      message: result.duplicated ? "Mensaje duplicado (ya enviado recientemente)" : "Error al enviar mensaje"
    }),
    {
      status: result.status || 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    }
  );
}
