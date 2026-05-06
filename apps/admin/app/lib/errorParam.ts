import { MISSING_WHATSAPP_TEMPLATE_MESSAGE } from "./notificationTemplate";

export function normalizeErrorParam(input?: string | null) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.includes("NEXT_REDIRECT")) return "";

  const norm = raw.toLowerCase();
  if (norm.includes("subscription_has_payments") || norm.includes("use_purgepayments=1_to_delete_with_payments")) {
    return "No se puede borrar: la suscripción tiene pagos asociados.";
  }
  if (norm.includes("subscription_has_dependencies")) {
    return "No se puede borrar: la suscripción tiene dependencias.";
  }
  if (norm.includes("subscription_must_be_canceled")) {
    return "Primero cancela la suscripción para poder eliminarla.";
  }
  if (norm.includes("subscription_canceled")) {
    return "La suscripción ya está cancelada.";
  }
  if (norm.includes("subscription_expired")) {
    return "La suscripción está expirada. Debes reactivarla, no suspenderla.";
  }
  if (norm.includes("subscription_already_suspended")) {
    return "La suscripción ya está suspendida.";
  }
  if (norm.includes("subscription_already_canceled")) {
    return "La suscripción ya está cancelada.";
  }
  if (norm.includes("subscription_not_suspended")) {
    return "Solo puedes reanudar suscripciones suspendidas.";
  }
  if (norm.includes("subscription_not_reactivatable")) {
    return "Solo puedes reactivar suscripciones canceladas o expiradas.";
  }
  if (norm.includes("plan_has_dependencies")) {
    return "No se puede borrar el plan: tiene dependencias.";
  }
  if (norm.includes("product_has_active_subscriptions")) {
    return "No se puede borrar: primero cancela las suscripciones activas/en mora/suspendidas de este producto.";
  }
  if (norm.includes("product_has_dependencies")) {
    return "No se puede borrar: el producto tiene dependencias.";
  }
  if (norm.includes("csrf_invalid") || norm.includes("csrf_blocked")) {
    return "La sesión expiró. Recarga la página e intenta de nuevo.";
  }
  if (norm.includes("wompi_payment_link_failed")) {
    return "No se pudo generar el link de pago en Wompi. Verifica credenciales, moneda y configuración.";
  }
  if (norm.includes("checkout_url_missing")) {
    return "Se intentó crear el link de pago, pero Wompi no devolvió URL de checkout.";
  }
  if (norm.includes("public_checkout_create_failed")) {
    return "No se pudo generar el checkout público para este envío.";
  }
  if (norm.includes("missing_checkout_for_product")) {
    return "No hay un checkout público asociado al producto seleccionado.";
  }
  if (norm.includes("missing_subscription_base_url")) {
    return "Falta configurar la URL base de suscripción en Checkout público.";
  }
  if (norm.includes("missing_plan_base_url")) {
    return "Falta configurar la URL base de link de pago en Checkout público.";
  }
  if (norm.includes("missing_public_base_url")) {
    return "Falta configurar la URL pública base en Checkout público.";
  }
  if (norm.includes("invalid_amount") || norm.includes("monto_invalido")) {
    return "Debes ingresar un monto válido para este envío.";
  }
  if (norm.includes("missing_customer_id")) {
    return "Falta el contacto para completar el envío.";
  }
  if (norm.includes("customer_not_found")) {
    return "No se encontró el contacto para este envío.";
  }
  if (norm.includes("tenant_required")) {
    return "Debes seleccionar un canal de ventas.";
  }
  if (norm.includes("product_required")) {
    return "Debes asociar al menos un producto.";
  }
  if (norm.includes("max_one_product")) {
    return "Solo se permite asociar un producto en este checkout.";
  }
  if (norm.includes("missing_subscription_or_customer")) {
    return "Faltan datos para enviar el link de pago (suscripción o cliente).";
  }
  if (norm.includes("centralcom_send_failed")) {
    return "No se pudo enviar el mensaje de WhatsApp. Revisa la configuración de Chatwoot.";
  }
  if (norm.includes("notification_not_delivered")) {
    return "La notificación no se entregó correctamente en WhatsApp.";
  }
  if (norm.includes("missing_template")) {
    return MISSING_WHATSAPP_TEMPLATE_MESSAGE;
  }
  if (norm.includes("notification_template_missing")) {
    return MISSING_WHATSAPP_TEMPLATE_MESSAGE;
  }
  if (norm.includes("whatsapp_template_missing")) {
    return MISSING_WHATSAPP_TEMPLATE_MESSAGE;
  }
  if (norm.includes("customer_phone_required")) {
    return "El contacto no tiene teléfono. Agrégalo antes de enviar el mensaje.";
  }
  if (norm.includes("missing_customer_fields")) {
    return "El contacto debe tener nombre, email y teléfono para enviarlo por Chatwoot.";
  }
  if (norm.includes("whatsapp_inbox_required")) {
    return "No hay un inbox de WhatsApp disponible para enviar esta plantilla.";
  }
  if (norm.includes("whatsapp_channel_required")) {
    return "El canal configurado no es de WhatsApp para esa plantilla.";
  }
  if (norm.includes("whatsapp_channel_lookup_failed")) {
    return "No se pudo validar el canal de WhatsApp en Chatwoot.";
  }
  if (norm.includes("chatwoot not configured") || norm.includes("chatwoot_not_configured")) {
    return "Chatwoot no está configurado para este entorno.";
  }
  if (norm.includes("contact not found/created") || norm.includes("contact_not_found")) {
    return "No se pudo crear o encontrar el contacto en Chatwoot.";
  }
  if (norm.includes("chatwoot_conversation_missing")) {
    return "No se pudo abrir la conversación en Chatwoot.";
  }

  return raw;
}
