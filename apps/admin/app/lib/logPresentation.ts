export function normalizeSystemText(value: unknown): string {
  let text = String(value || "").trim();
  if (!text) return "";
  const replacements: Array<[RegExp, string]> = [
    [/subscription_reference_not_found/gi, "Referencia de suscripción no encontrada"],
    [/subscription reference not found/gi, "Referencia de suscripción no encontrada"],
    [/falling back to inference/gi, "se intentó asociar automáticamente"],
    [/ambiguous plan inference by price/gi, "No se pudo inferir la suscripción por precio"],
    [/forward returned 5xx but treated as accepted/gi, "El reenvío respondió 5xx, se aceptó para reintento"],
    [/job failed/gi, "Tarea fallida"],
    [/will retry/gi, "se reintentará"],
    [/sql console execution/gi, "Ejecución de consola SQL"],
    [/webhook reconciled/gi, "Webhook conciliado"],
    [/webhook received/gi, "Webhook recibido"],
    [/payment_link_not_found/gi, "Link de pago no encontrado"],
    [/proceeding by inference/gi, "se intentó asociar automáticamente"],
    [/payment retry/gi, "Reintento de pago"],
    [/tokenization_token_expired/gi, "El token de tokenización venció"]
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s{2,}/g, " ").trim();
}

export function isNoiseNotification(input: { source?: unknown; title?: unknown; message?: unknown; kind?: unknown }): boolean {
  const source = String(input.source || "").toLowerCase().trim();
  const kind = String(input.kind || "").toLowerCase().trim();
  const title = normalizeSystemText(input.title).toLowerCase();
  const message = normalizeSystemText(input.message).toLowerCase();
  const whole = `${title} ${message}`.trim();

  if (source === "sql.console" || source === "data_trainer") return true;
  if (source === "webhooks.wompi" && /webhook recibido/.test(whole)) return true;
  if (source === "notifications.dispatch" && /procesando notificacion|mensaje en cola para envio|mensaje enviado|tipo de pago no permitido/.test(whole)) return true;
  if (source === "notifications.schedule" && /no hay reglas activas para notificaciones/.test(whole)) return true;
  if (source === "processwompievent" && /payment_link_not_found|link de pago no encontrado/.test(whole)) return true;
  if (/subscription reference not found|referencia de suscripción no encontrada|ambiguous plan inference by price/.test(whole)) return true;
  if (/forward returned 5xx|reenvío respondió 5xx/.test(whole)) return true;
  if (kind === "heartbeat") return true;

  return false;
}
