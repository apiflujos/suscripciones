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
  if (norm.includes("missing_subscription_or_customer")) {
    return "Faltan datos para enviar el link de pago (suscripción o cliente).";
  }
  if (norm.includes("centralcom_send_failed")) {
    return "No se pudo enviar el mensaje por CentralCom.";
  }

  return raw;
}
