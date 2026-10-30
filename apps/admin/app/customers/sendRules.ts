import {
  isNotificationTemplateConfigured,
  resolveNotificationTemplateForTrigger
} from "../lib/notificationTemplate";

/**
 * Reglas para enviar un link de pago, un catálogo o un link de débito automático a
 * un contacto. Antes vivían dentro de CustomersTable y se evaluaban en el navegador
 * por cada fila; ahora se evalúan en el servidor solo para el contacto de la página.
 */

export type SendKind = "link" | "catalog" | "token";
export type CatalogMode = "PLAN" | "SUBSCRIPTION";
type TemplateKind = "PLAN" | "SUBSCRIPTION" | "CART";
export type SendAction = "PAYMENT" | "TOKEN" | "CATALOG_PLAN" | "CATALOG_SUBSCRIPTION";

export type SendContext = {
  customer: { id: string; tenantId?: string | null; tenantIds?: string[] };
  /** Producto de la suscripción vigente del contacto ("" si no tiene). */
  productId: string;
  checkoutTemplates: any[];
  checkoutConfig?: any;
  notificationsConfig?: any;
  /** Canal elegido en la lista (filtro); si no hay, el del contacto. */
  currentTenantId?: string;
};

function extractTemplateProductId(entry: any) {
  if (!entry) return "";
  if (typeof entry === "string") return String(entry).trim();
  if (typeof entry === "object") return String(entry?.id || "").trim();
  return "";
}

function templateMatchesProduct(template: any, productId: string) {
  const list = Array.isArray(template?.productIds) ? template.productIds : [];
  return list.some((entry: any) => String(extractTemplateProductId(entry)) === String(productId));
}

function templateMatchesTenant(template: any, tenantId?: string | null) {
  const resolvedTenantId = String(tenantId || "").trim();
  if (!resolvedTenantId) return true;
  const templateTenantId = String(template?.tenantId || "").trim();
  return !templateTenantId || templateTenantId === resolvedTenantId;
}

export function resolveEffectiveTenantId(ctx: SendContext) {
  return String(ctx.currentTenantId || ctx.customer.tenantId || ctx.customer.tenantIds?.[0] || "").trim();
}

function defaultTemplateIdForKind(ctx: SendContext, kind: TemplateKind) {
  const cfg = ctx.checkoutConfig || {};
  if (kind === "PLAN") return String(cfg.defaultPlanTemplateId || "").trim();
  if (kind === "SUBSCRIPTION") return String(cfg.defaultSubscriptionTemplateId || "").trim();
  return String(cfg.defaultCartTemplateId || "").trim();
}

export function findCheckoutTemplate(ctx: SendContext, kind: TemplateKind, productId: string) {
  const effectiveTenantId = resolveEffectiveTenantId(ctx);
  const candidates = (ctx.checkoutTemplates || []).filter(
    (t: any) => Boolean(t?.active) && String(t?.kind || "") === kind && templateMatchesTenant(t, effectiveTenantId)
  );

  if (productId) {
    const exactTenantMatch =
      candidates.find((t: any) => String(t?.tenantId || "").trim() === effectiveTenantId && templateMatchesProduct(t, productId)) || null;
    if (exactTenantMatch) return exactTenantMatch;
    const productMatch = candidates.find((t: any) => templateMatchesProduct(t, productId)) || null;
    if (productMatch) return productMatch;
  }

  const defaultTemplateId = defaultTemplateIdForKind(ctx, kind);
  if (!defaultTemplateId) return null;
  const exactDefault =
    candidates.find((t: any) => String(t?.tenantId || "").trim() === effectiveTenantId && String(t?.id || "").trim() === defaultTemplateId) || null;
  if (exactDefault) return exactDefault;
  return candidates.find((t: any) => String(t?.id || "").trim() === defaultTemplateId) || null;
}

export function resolveMessageTemplate(
  ctx: SendContext,
  trigger: Parameters<typeof resolveNotificationTemplateForTrigger>[0]["trigger"],
  paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK"
) {
  const cfg = ctx.notificationsConfig || {};
  return resolveNotificationTemplateForTrigger({
    rules: Array.isArray(cfg?.rules) ? cfg.rules : [],
    templates: Array.isArray(cfg?.templates) ? cfg.templates : [],
    trigger,
    paymentType
  });
}

/** "" si se puede enviar; si no, el código del motivo (ver `mapSendError`). */
export function resolveActionBlockReason(ctx: SendContext, action: SendAction): string {
  const productId = ctx.productId;
  const cfg = ctx.checkoutConfig || {};
  const planBase = String(cfg.planBaseUrl || "").trim();
  const subBase = String(cfg.subscriptionBaseUrl || "").trim();
  const publicBase = String(cfg.planBaseUrl || cfg.cartBaseUrl || cfg.subscriptionBaseUrl || "").trim();

  if (action === "PAYMENT") {
    if (!productId) return "missing_product_for_customer";
    if (!findCheckoutTemplate(ctx, "PLAN", productId)) return "missing_checkout_for_product";
    if (!planBase) return "missing_plan_base_url";
    return isNotificationTemplateConfigured(resolveMessageTemplate(ctx, "PAYMENT_LINK_CREATED", "LINK")) ? "" : "missing_template";
  }

  if (action === "TOKEN") {
    if (!productId) return "missing_product_for_customer";
    if (!findCheckoutTemplate(ctx, "SUBSCRIPTION", productId)) return "missing_checkout_for_product";
    if (!subBase) return "missing_subscription_base_url";
    return isNotificationTemplateConfigured(resolveMessageTemplate(ctx, "TOKENIZATION_LINK_CREATED")) ? "" : "missing_template";
  }

  if (!findCheckoutTemplate(ctx, "CART", productId)) return productId ? "missing_checkout_for_product" : "missing_cart_template";
  if (action === "CATALOG_SUBSCRIPTION" && !subBase) return "missing_subscription_base_url";
  if (action === "CATALOG_PLAN" && !publicBase) return "missing_public_base_url";
  return isNotificationTemplateConfigured(
    resolveMessageTemplate(ctx, "CATALOG_LINK_CREATED", action === "CATALOG_SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN")
  )
    ? ""
    : "missing_template";
}

/** Modo de catálogo que conviene proponer primero. */
export function preferredCatalogMode(ctx: SendContext, collectionMode: string): CatalogMode {
  const wantsSubscription = collectionMode === "AUTO_DEBIT";
  const canPlan = !resolveActionBlockReason(ctx, "CATALOG_PLAN");
  const canSub = !resolveActionBlockReason(ctx, "CATALOG_SUBSCRIPTION");
  if (wantsSubscription) return canSub ? "SUBSCRIPTION" : "PLAN";
  return canPlan ? "PLAN" : "SUBSCRIPTION";
}

export function mapSendError(code: string) {
  const normalized = String(code || "").trim();
  switch (normalized) {
    case "missing_public_base_url":
      return "Falta configurar la URL pública base en Checkout público.";
    case "missing_subscription_base_url":
      return "Falta configurar la URL base de suscripción en Checkout público.";
    case "missing_plan_base_url":
      return "Falta configurar la URL base de plan en Checkout público.";
    case "missing_cart_template":
      return "No hay plantillas de catálogo activas. Crea una en Checkout público.";
    case "missing_plan_template":
      return "No hay plantillas de link de pago activas. Crea una en Checkout público.";
    case "missing_subscription_template":
      return "No hay plantillas de suscripción activas. Crea una en Checkout público.";
    case "missing_checkout_for_product":
      return "No hay un checkout público asociado al producto de este contacto.";
    case "missing_product_for_customer":
      return "Este contacto no tiene un producto o suscripción asociada. Solo puedes enviar catálogo hasta que el cliente elija qué producto contratar.";
    case "missing_template":
      return "Falta una plantilla WhatsApp activa en Notificaciones para este envío.";
    case "customer_phone_required":
      return "El contacto no tiene teléfono. Agrégalo antes de enviar el mensaje.";
    case "missing_customer_fields":
      return "El contacto debe tener nombre, email y teléfono para enviarlo por Chatwoot.";
    case "monto_invalido":
    case "invalid_amount":
      return "Debes ingresar un monto válido para el link de pago.";
    case "whatsapp_inbox_required":
      return "No hay un inbox de WhatsApp disponible para enviar esta plantilla.";
    case "whatsapp_channel_required":
      return "El canal seleccionado no es de WhatsApp y la plantilla no se puede enviar.";
    case "whatsapp_channel_lookup_failed":
      return "No se pudo validar el canal de WhatsApp en Chatwoot.";
    case "chatwoot not configured":
    case "chatwoot_not_configured":
      return "Chatwoot no está configurado para este entorno.";
    case "contact not found/created":
    case "contact_not_found":
      return "No se pudo crear o encontrar el contacto en Chatwoot.";
    case "chatwoot_conversation_missing":
      return "No se pudo abrir la conversación en Chatwoot.";
    case "no_rules":
      return "Falta una plantilla WhatsApp activa en Notificaciones para este envío.";
    case "invalid_body":
      return "Faltan datos obligatorios. Revisa la configuración.";
    case "invalid_payload":
      return "No se pudo preparar el link. Revisa la configuración del checkout.";
    case "invalid_json":
      return "No se pudo procesar la solicitud. Intenta nuevamente.";
    case "auth_required":
      return "Sesión vencida. Vuelve a iniciar sesión.";
    case "customer_not_found":
      return "No se encontró el contacto para este envío.";
    case "public_checkout_create_failed":
      return "No se pudo generar el checkout público para este envío.";
    case "store_failed":
      return "No se pudo guardar el link en el contacto.";
    case "centralcom_failed":
      return "No se pudo enviar el mensaje de WhatsApp. Revisa la configuración de Chatwoot.";
    case "request_failed":
    case "send_failed":
      return "No se pudo enviar el mensaje. Intenta nuevamente.";
    default:
      return normalized || "No se pudo enviar el mensaje.";
  }
}
