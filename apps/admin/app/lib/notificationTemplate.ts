import type { NotificationPaymentType, NotificationRule, NotificationTemplate, NotificationTrigger } from "@suscripciones/core/services/notificationsConfig";
import { resolveNotificationTemplate } from "@suscripciones/core/services/notificationsConfig";

export const MISSING_WHATSAPP_TEMPLATE_MESSAGE =
  "Falta configurar una plantilla WhatsApp activa en Notificaciones para este envío.";

export const NO_WHATSAPP_TEMPLATE_PREVIEW = "No hay plantilla WhatsApp activa en Notificaciones.";

export function isNotificationTemplateConfigured(template: NotificationTemplate | null | undefined): boolean {
  if (!template || typeof template !== "object") return false;
  return Boolean(String(template?.chatwootTemplate?.name || "").trim());
}

export function renderNotificationTemplatePreview(template: NotificationTemplate | null | undefined): string {
  if (!isNotificationTemplateConfigured(template)) return NO_WHATSAPP_TEMPLATE_PREVIEW;
  const name = String(template?.chatwootTemplate?.name || "").trim();
  const lang = String(template?.chatwootTemplate?.language || "").trim();
  const params = template?.chatwootTemplate?.processed_params?.body || [];
  const paramText = Array.isArray(params) && params.length ? params.map((p) => String((p as { value?: string })?.value || "")).join(" | ") : "—";
  return `Plantilla WhatsApp: ${name}${lang ? ` (${lang})` : ""}\nParámetros: ${paramText}`;
}

export function resolveNotificationTemplateForTrigger(args: {
  rules?: NotificationRule[];
  templates?: NotificationTemplate[];
  trigger: NotificationTrigger;
  paymentType?: NotificationPaymentType;
}) {
  return resolveNotificationTemplate({
    rules: args.rules,
    templates: args.templates,
    trigger: args.trigger,
    paymentType: args.paymentType
  });
}
