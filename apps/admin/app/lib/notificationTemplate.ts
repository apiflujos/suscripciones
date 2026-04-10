export const MISSING_WHATSAPP_TEMPLATE_MESSAGE =
  "Falta configurar una plantilla WhatsApp activa en Notificaciones para este envío.";

export const NO_WHATSAPP_TEMPLATE_PREVIEW = "No hay plantilla WhatsApp activa en Notificaciones.";

export function isNotificationTemplateConfigured(template: any): boolean {
  if (!template || typeof template !== "object") return false;
  return Boolean(String(template?.chatwootTemplate?.name || "").trim());
}

export function renderNotificationTemplatePreview(template: any): string {
  if (!isNotificationTemplateConfigured(template)) return NO_WHATSAPP_TEMPLATE_PREVIEW;
  const name = String(template?.chatwootTemplate?.name || "").trim();
  const lang = String(template?.chatwootTemplate?.language || "").trim();
  const params = template?.chatwootTemplate?.processed_params?.body || [];
  const paramText = Array.isArray(params) && params.length ? params.map((p: any) => String(p?.value || "")).join(" | ") : "—";
  return `Plantilla WhatsApp: ${name}${lang ? ` (${lang})` : ""}\nParámetros: ${paramText}`;
}
