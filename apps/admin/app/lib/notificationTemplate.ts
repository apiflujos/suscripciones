type NotificationPaymentType = "PLAN" | "SUBSCRIPTION" | "LINK";
type NotificationTrigger =
  | "SUBSCRIPTION_DUE"
  | "PAYMENT_LINK_CREATED"
  | "PAYMENT_APPROVED"
  | "PAYMENT_DECLINED"
  | "CATALOG_LINK_CREATED"
  | "TOKENIZATION_LINK_CREATED";

type NotificationRule = {
  id: string;
  enabled?: boolean | null;
  trigger: NotificationTrigger;
  templateId: string;
  conditions?: {
    requirePaymentTypeIn?: NotificationPaymentType[] | null;
  } | null;
};

type NotificationTemplate = {
  id: string;
  chatwootTemplate?: {
    name?: string | null;
    language?: string | null;
    processed_params?: {
      body?: Array<{ value?: string | null }> | null;
    } | null;
  } | null;
};

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
  const rules = Array.isArray(args.rules) ? args.rules : [];
  const templates = Array.isArray(args.templates) ? args.templates : [];
  const candidates = rules.filter((rule) => rule.enabled !== false && rule.trigger === args.trigger);
  const selectedRule =
    (args.paymentType
      ? candidates.find((rule) => {
          const types = Array.isArray(rule.conditions?.requirePaymentTypeIn)
            ? rule.conditions?.requirePaymentTypeIn
            : [];
          return types.includes(args.paymentType as NotificationPaymentType);
        })
      : null) ||
    candidates.find((rule) => {
      const types = Array.isArray(rule.conditions?.requirePaymentTypeIn)
        ? rule.conditions?.requirePaymentTypeIn
        : [];
      return types.length === 0;
    }) ||
    null;

  if (!selectedRule) return null;
  return templates.find((template) => String(template.id) === String(selectedRule.templateId)) || null;
}
