/**
 * Traduce los errores del motor de cobros y de notificaciones a algo que le
 * sirva a quien opera. Vive fuera de las acciones para que el tablero muestre
 * exactamente el mismo texto que ve quien ejecuta la acción a mano.
 */
export function humanizeChargeError(raw: string) {
  const msg = String(raw || "").trim();
  if (!msg) return "No se pudo procesar el cobro.";
  if (msg.includes("customer_payment_source_missing")) return "El cliente no tiene una tarjeta tokenizada lista para débito automático.";
  if (msg.includes("customer_email_required")) return "El cliente no tiene correo electrónico y Wompi lo exige para cobrar.";
  if (msg.includes("charge_not_due_yet")) return "La suscripción todavía no está en fecha de cobro.";
  if (msg.includes("pending_charge_exists")) return "Ya existe un cobro pendiente reciente para esta suscripción.";
  if (msg.includes("manual_charge_disabled_by_settings")) return "El cobro manual está deshabilitado en la configuración.";
  if (msg.includes("manual_charge_not_allowed")) return "Esta suscripción no permite cobro manual.";
  if (msg.includes("payment_already_approved")) return "Esta suscripción ya fue cobrada para el ciclo actual.";
  if (msg.includes("subscription_not_found")) return "No se encontró la suscripción para el canal seleccionado.";
  if (msg.includes("invalid_body")) return "La solicitud de cobro es inválida.";
  if (msg.includes("fetch_failed")) return "No se pudo conectar con el API de suscripciones.";
  if (msg.includes("wompi_reference_already_used_guard")) return "Se bloqueó el cobro para evitar una transacción duplicada en Wompi.";
  if (msg.includes("wompi_private_key_not_configured")) return "Falta configurar la llave privada de Wompi.";
  if (msg.includes("wompi_public_key_not_configured")) return "Falta configurar la llave pública de Wompi.";
  if (msg.includes("wompi_integrity_secret_not_configured")) return "Falta configurar la firma de integridad de Wompi.";
  if (msg.includes("auto_debit_in_progress")) return "Ya hay un intento de débito automático en proceso.";
  if (msg.includes("charge_too_soon")) return "Se acaba de intentar un cobro para esta suscripción. Esperá un minuto antes de volver a cobrar.";
  if (msg.includes("csrf_invalid")) return "La sesión expiró. Recarga la página e intenta de nuevo.";
  return "No se pudo cobrar la suscripción.";
}

export function humanizeNotificationError(raw: string) {
  const msg = String(raw || "").trim();
  if (!msg) return "No se pudo enviar la notificación.";
  if (msg === "missing_template") return "Falta una plantilla activa para este envío.";
  if (msg === "notification_not_delivered") return "La notificación no se pudo entregar.";
  if (msg === "chatwoot_send_failed") return "La central de comunicaciones no pudo enviar el mensaje.";
  // Nunca se devuelve el código crudo: quien opera no lee identificadores.
  return "No se pudo enviar la notificación.";
}

const CHARGE_ORIGIN_LABEL: Record<string, string> = {
  AUTO_DEBIT: "El débito automático",
  AUTO_LINK: "El cobro por link",
  MANUAL_LINK: "El cobro por link",
  MANUAL_USER: "El cobro manual",
  WEBHOOK: "El cobro"
};

/** Por qué no entró la plata, en una línea que sirva para actuar. */
export function describeChargeFailure(status: string, origin: string) {
  const quien = CHARGE_ORIGIN_LABEL[origin] ?? "El cobro";
  if (status === "DECLINED") return `${quien} fue rechazado.`;
  return `${quien} no se pudo procesar.`;
}
