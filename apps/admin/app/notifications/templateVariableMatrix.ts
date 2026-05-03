import type { NotificationPaymentType } from "@suscripciones/core/services/notificationsConfig";
import type { RealtimeNotificationKey } from "./realtimeDefinitions";

export type ReminderNotificationKey =
  | "reminder_due_link"
  | "reminder_due_subscription"
  | "reminder_mora_link"
  | "reminder_mora_subscription";

export type NotificationVariableOption = {
  label: string;
  value: string;
};

const CORE_MESSAGE_VARIABLES: NotificationVariableOption[] = [
  { label: "Nombre completo", value: "{{customer.name}}" },
  { label: "Correo electrónico", value: "{{customer.email}}" },
  { label: "Teléfono", value: "{{customer.phone}}" },
  { label: "Nombre del producto", value: "{{plan.name}}" },
  { label: "Precio del producto (pesos)", value: "{{plan.priceInPesos}}" },
  { label: "Moneda del producto", value: "{{plan.currency}}" },
  { label: "Monto del pago (pesos)", value: "{{payment.amountInPesos}}" },
  { label: "Moneda del pago", value: "{{payment.currency}}" },
  { label: "Estado del pago", value: "{{payment.status}}" },
  { label: "Referencia", value: "{{payment.reference}}" },
  { label: "Estado de la suscripción", value: "{{subscription.status}}" },
  { label: "Ciclo activo", value: "{{subscription.activeCycleNumber}}" },
  { label: "Inicio del ciclo activo", value: "{{subscription.activeCycleStartAt}}" },
  { label: "Fin del ciclo activo", value: "{{subscription.activeCycleEndAt}}" },
  { label: "Ciclo de cobro", value: "{{subscription.collectionCycleNumber}}" },
  { label: "Próximo cobro", value: "{{subscription.nextBillingDate}}" },
  { label: "Fecha de pago", value: "{{payment.paidAt}}" },
  { label: "Fecha de creación del pago", value: "{{payment.createdAt}}" },
  { label: "Fecha de fallo del pago", value: "{{payment.failedAt}}" },
  { label: "Recurrencia · cada (cantidad)", value: "{{plan.intervalCount}}" },
  { label: "Recurrencia · unidad", value: "{{plan.intervalUnit}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const LINK_PAYMENT_VARIABLES: NotificationVariableOption[] = [
  { label: "Link de cobro actual", value: "{{paymentLink.url}}" },
  { label: "Checkout público automático (según este evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout público automático · Cobro puntual", value: "{{checkoutPublicUrl.AUTO_PLAN}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_LINK_VARIABLES: NotificationVariableOption[] = [
  { label: "Link de cobro actual", value: "{{paymentLink.url}}" },
  { label: "Checkout público automático (según este evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout público automático · Suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const TOKENIZATION_VARIABLES: NotificationVariableOption[] = [
  { label: "Link de tokenización actual", value: "{{tokenizationLink.url}}" },
  { label: "URL de tokenización", value: "{{tokenization.url}}" },
  { label: "Checkout público automático (según este evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout público automático · Suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const CATALOG_VARIABLES: NotificationVariableOption[] = [
  { label: "Link de catálogo actual", value: "{{cartLink.url}}" },
  { label: "URL de catálogo", value: "{{catalog.url}}" },
  { label: "Checkout público automático (según este evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout público automático · Catálogo", value: "{{checkoutPublicUrl.AUTO_CART}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const PLAN_TOKEN_VARIABLES: NotificationVariableOption[] = [
  { label: "Token checkout automático (según este evento)", value: "{{checkoutPublicToken.AUTO}}" },
  { label: "Token checkout automático · Cobro puntual", value: "{{checkoutPublicToken.AUTO_PLAN}}" },
  { label: "Link de cobro actual", value: "{{paymentLink.url}}" },
  { label: "Checkout público automático (según este evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout público automático · Cobro puntual", value: "{{checkoutPublicUrl.AUTO_PLAN}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_TOKEN_VARIABLES: NotificationVariableOption[] = [
  { label: "Token checkout automático (según este evento)", value: "{{checkoutPublicToken.AUTO}}" },
  { label: "Token checkout automático · Suscripción", value: "{{checkoutPublicToken.AUTO_SUBSCRIPTION}}" },
  { label: "Link de cobro actual", value: "{{paymentLink.url}}" },
  { label: "Link de tokenización actual", value: "{{tokenizationLink.url}}" },
  { label: "URL de tokenización", value: "{{tokenization.url}}" },
  { label: "Checkout público automático (según este evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout público automático · Suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const CATALOG_TOKEN_VARIABLES: NotificationVariableOption[] = [
  { label: "Token checkout automático (según este evento)", value: "{{checkoutPublicToken.AUTO}}" },
  { label: "Token checkout automático · Catálogo", value: "{{checkoutPublicToken.AUTO_CART}}" },
  { label: "Link de catálogo actual", value: "{{cartLink.url}}" },
  { label: "URL de catálogo", value: "{{catalog.url}}" },
  { label: "Checkout público automático (según este evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout público automático · Catálogo", value: "{{checkoutPublicUrl.AUTO_CART}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

type TemplateVariableMatrix = {
  bodyVariables: NotificationVariableOption[];
  buttonVariables: NotificationVariableOption[];
  helpText: string;
};

function dedupeOptions(options: NotificationVariableOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function buildMatrix(args: {
  body: NotificationVariableOption[];
  button: NotificationVariableOption[];
  helpText: string;
}): TemplateVariableMatrix {
  return {
    bodyVariables: dedupeOptions([...CORE_MESSAGE_VARIABLES, ...args.body]),
    buttonVariables: dedupeOptions(args.button),
    helpText: args.helpText
  };
}

const REALTIME_VARIABLE_MATRIX: Record<RealtimeNotificationKey, TemplateVariableMatrix> = {
  catalog_link_created_plan: buildMatrix({
    body: CATALOG_VARIABLES,
    button: CATALOG_TOKEN_VARIABLES,
    helpText: "Usa variables de catálogo. Este evento no debería usar links de tokenización ni de cobro de suscripción."
  }),
  catalog_link_created_subscription: buildMatrix({
    body: CATALOG_VARIABLES,
    button: CATALOG_TOKEN_VARIABLES,
    helpText: "Usa variables del checkout de catálogo para alta de suscripción. Evita links de cobro puntual o tokenización."
  }),
  tokenization_link_created: buildMatrix({
    body: TOKENIZATION_VARIABLES,
    button: SUBSCRIPTION_TOKEN_VARIABLES,
    helpText: "Usa variables de tokenización o checkout automático de suscripción. Este evento no envía links de catálogo."
  }),
  payment_link_created: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_TOKEN_VARIABLES,
    helpText: "Usa variables del link de cobro puntual. Este evento no corresponde a débito automático ni catálogo."
  }),
  payment_link_created_subscription: buildMatrix({
    body: SUBSCRIPTION_LINK_VARIABLES,
    button: SUBSCRIPTION_TOKEN_VARIABLES,
    helpText: "Usa variables del link de cobro de una suscripción por link. No mezcles catálogo ni tokenización aislada."
  }),
  payment_success: buildMatrix({
    body: [],
    button: [],
    helpText: "Usa variables de cliente, suscripción y pago aprobado. Este evento normalmente no requiere botones."
  }),
  payment_failed_link: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_TOKEN_VARIABLES,
    helpText: "Usa variables de reintento para cobro puntual. No mezcles catálogo ni links de tokenización."
  }),
  payment_failed_subscription: buildMatrix({
    body: [...SUBSCRIPTION_LINK_VARIABLES, ...TOKENIZATION_VARIABLES],
    button: SUBSCRIPTION_TOKEN_VARIABLES,
    helpText: "Usa variables de recuperación de suscripción: link de cobro o tokenización, según tu plantilla."
  })
};

const REMINDER_VARIABLE_MATRIX: Record<ReminderNotificationKey, TemplateVariableMatrix> = {
  reminder_due_link: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_TOKEN_VARIABLES,
    helpText: "Recordatorio previo para pago puntual. Usa variables del cobro puntual."
  }),
  reminder_due_subscription: buildMatrix({
    body: TOKENIZATION_VARIABLES,
    button: SUBSCRIPTION_TOKEN_VARIABLES,
    helpText: "Recordatorio previo para débito automático. Usa variables de tokenización o checkout automático de suscripción."
  }),
  reminder_mora_link: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_TOKEN_VARIABLES,
    helpText: "Recordatorio en mora para pago puntual. Usa variables del cobro puntual."
  }),
  reminder_mora_subscription: buildMatrix({
    body: [...SUBSCRIPTION_LINK_VARIABLES, ...TOKENIZATION_VARIABLES],
    button: SUBSCRIPTION_TOKEN_VARIABLES,
    helpText: "Recordatorio en mora para débito automático. Usa recuperación por tokenización o link de cobro de suscripción."
  })
};

export const ALL_NOTIFICATION_VARIABLE_OPTIONS = dedupeOptions([
  ...CORE_MESSAGE_VARIABLES,
  ...LINK_PAYMENT_VARIABLES,
  ...SUBSCRIPTION_LINK_VARIABLES,
  ...TOKENIZATION_VARIABLES,
  ...CATALOG_VARIABLES,
  ...PLAN_TOKEN_VARIABLES,
  ...SUBSCRIPTION_TOKEN_VARIABLES,
  ...CATALOG_TOKEN_VARIABLES
]);

export function getRealtimeVariableMatrix(key: RealtimeNotificationKey) {
  return REALTIME_VARIABLE_MATRIX[key];
}

export function getReminderVariableMatrix(args: {
  kind: "DUE" | "MORA";
  paymentType: Extract<NotificationPaymentType, "LINK" | "SUBSCRIPTION">;
}) {
  const suffix = args.paymentType === "SUBSCRIPTION" ? "subscription" : "link";
  const prefix = args.kind === "MORA" ? "reminder_mora" : "reminder_due";
  return REMINDER_VARIABLE_MATRIX[`${prefix}_${suffix}` as ReminderNotificationKey];
}

export function getAllowedTemplateValues(args:
  | { type: "realtime"; key: RealtimeNotificationKey }
  | { type: "reminder"; kind: "DUE" | "MORA"; paymentType: Extract<NotificationPaymentType, "LINK" | "SUBSCRIPTION"> }
) {
  const matrix =
    args.type === "realtime"
      ? getRealtimeVariableMatrix(args.key)
      : getReminderVariableMatrix({ kind: args.kind, paymentType: args.paymentType });
  return {
    bodyValues: new Set(matrix.bodyVariables.map((option) => option.value)),
    headerValues: new Set(matrix.bodyVariables.map((option) => option.value)),
    buttonValues: new Set(matrix.buttonVariables.map((option) => option.value))
  };
}
