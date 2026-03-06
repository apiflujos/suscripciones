export function normalizeSystemText(value: unknown): string {
  let text = String(value || "").trim();
  if (!text) return "";
  
  // Replacements directos para términos técnicos que puedan escapar del backend
  const replacements: Array<[RegExp, string]> = [
    [/subscription_reference_not_found/gi, "Referencia de suscripción no encontrada"],
    [/payment_link_not_found/gi, "Link de pago no encontrado"],
    [/falling back to inference/gi, "Asociación automática"],
    [/proceeding by inference/gi, "Asociación automática"],
    [/job failed/gi, "Tarea fallida"],
    [/will retry/gi, "reintentando"],
    [/sql console execution/gi, "Consola SQL"],
    [/webhook reconciled/gi, "Webhook conciliado"],
    [/tokenization_token_expired/gi, "Token vencido"]
  ];
  
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  
  // Limpieza de guiones bajos sobrantes en títulos/mensajes
  if (text.includes("_") && !text.includes(" ")) {
    text = text.replace(/_/g, " ");
  }

  return text.replace(/\s{2,}/g, " ").trim();
}

export function isNoiseNotification(input: { source?: unknown; title?: unknown; message?: unknown; kind?: unknown }): boolean {
  const source = String(input.source || "").toLowerCase().trim();
  const kind = String(input.kind || "").toLowerCase().trim();
  const title = normalizeSystemText(input.title).toLowerCase();
  const message = normalizeSystemText(input.message).toLowerCase();
  const whole = `${title} ${message}`.trim();

  // Filtro de ruido estricto para la campanita del Admin
  if (source === "sql.console" || source === "data_trainer" || source === "audit.billing") return true;
  if (source === "webhooks.wompi" && message.includes("recibido")) return true;
  
  // Notificaciones de flujo interno
  if (source === "notifications.dispatch" || source === "notifications.schedule") return true;
  if (source === "chatwoot.send" && message.includes("enviado")) return true;
  if (source === "processwompievent" && (message.includes("recibido") || message.includes("conciliado") || message.includes("asociar"))) return true;
  
  // Ignorar avisos informativos genéricos que no sean errores/alertas
  if (kind === "webhook_received" || kind === "heartbeat") return true;
  if (kind === "message_sent" || kind === "link_sent") return true;

  return false;
}
