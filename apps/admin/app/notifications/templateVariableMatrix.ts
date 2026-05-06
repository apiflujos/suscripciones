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
  recommended?: boolean;
};

const CORE_MESSAGE_VARIABLES: NotificationVariableOption[] = [
  { label: "Nombre del cliente", value: "{{customer.name}}" },
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
  { label: "Mes del ciclo activo", value: "{{subscription.activeCycleLabel}}" },
  { label: "Inicio del ciclo activo", value: "{{subscription.activeCycleStartAt}}" },
  { label: "Fin del ciclo activo", value: "{{subscription.activeCycleEndAt}}" },
  { label: "Ciclo de cobro", value: "{{subscription.collectionCycleNumber}}" },
  { label: "Mes del ciclo de cobro", value: "{{subscription.collectionCycleLabel}}" },
  { label: "Próximo cobro", value: "{{subscription.nextBillingDate}}" },
  { label: "Fecha de pago", value: "{{payment.paidAt}}" },
  { label: "Fecha de creación del pago", value: "{{payment.createdAt}}" },
  { label: "Fecha de fallo del pago", value: "{{payment.failedAt}}" },
  { label: "Recurrencia · cada (cantidad)", value: "{{plan.intervalCount}}" },
  { label: "Recurrencia · unidad", value: "{{plan.intervalUnit}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const LINK_PAYMENT_VARIABLES: NotificationVariableOption[] = [
  { label: "Link creado por este evento", value: "{{paymentLink.url}}", recommended: true },
  { label: "Checkout automático recomendado para este evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout automático · pago único", value: "{{checkoutPublicUrl.AUTO_PLAN}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_LINK_VARIABLES: NotificationVariableOption[] = [
  { label: "Link creado por este evento", value: "{{paymentLink.url}}", recommended: true },
  { label: "Checkout automático recomendado para este evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout automático · suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const TOKENIZATION_VARIABLES: NotificationVariableOption[] = [
  { label: "Link de tokenización actual", value: "{{tokenizationLink.url}}" },
  { label: "URL de tokenización", value: "{{tokenization.url}}", recommended: true },
  { label: "Checkout automático recomendado para este evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout automático · suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const CATALOG_VARIABLES: NotificationVariableOption[] = [
  { label: "Link de catálogo actual", value: "{{cartLink.url}}" },
  { label: "URL de catálogo", value: "{{catalog.url}}", recommended: true },
  { label: "Checkout automático recomendado para este evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout automático · catálogo", value: "{{checkoutPublicUrl.AUTO_CART}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const PLAN_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "Link creado por este evento", value: "{{paymentLink.url}}", recommended: true },
  { label: "Checkout automático recomendado para este evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout automático · pago único", value: "{{checkoutPublicUrl.AUTO_PLAN}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_LINK_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "Link creado por este evento", value: "{{paymentLink.url}}", recommended: true },
  { label: "Checkout automático recomendado para este evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout automático · suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const TOKENIZATION_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "URL de tokenización", value: "{{tokenization.url}}", recommended: true },
  { label: "Link de tokenización actual", value: "{{tokenizationLink.url}}" },
  { label: "Checkout automático recomendado para este evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout automático · suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_RECOVERY_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "URL de tokenización", value: "{{tokenization.url}}", recommended: true },
  { label: "Link de tokenización actual", value: "{{tokenizationLink.url}}" },
  { label: "Link creado por este evento", value: "{{paymentLink.url}}" },
  { label: "Checkout automático recomendado para este evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout automático · suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const CATALOG_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "URL de catálogo", value: "{{catalog.url}}", recommended: true },
  { label: "Link de catálogo actual", value: "{{cartLink.url}}" },
  { label: "Checkout automático recomendado para este evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Checkout automático · catálogo", value: "{{checkoutPublicUrl.AUTO_CART}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

type TemplateVariableMatrix = {
  bodyVariables: NotificationVariableOption[];
  buttonVariables: NotificationVariableOption[];
  helpText: string;
  recommendedButtonLabel?: string | null;
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
  recommendedButtonLabel?: string | null;
}): TemplateVariableMatrix {
  return {
    bodyVariables: dedupeOptions([...CORE_MESSAGE_VARIABLES, ...args.body]),
    buttonVariables: dedupeOptions(args.button),
    helpText: args.helpText,
    recommendedButtonLabel: args.recommendedButtonLabel ?? null
  };
}

const REALTIME_VARIABLE_MATRIX: Record<RealtimeNotificationKey, TemplateVariableMatrix> = {
  catalog_link_created_plan: buildMatrix({
    body: CATALOG_VARIABLES,
    button: CATALOG_BUTTON_VARIABLES,
    helpText: "Usa variables de catálogo. Este evento no debería usar links de tokenización ni de cobro de suscripción.",
    recommendedButtonLabel: "Link de catálogo"
  }),
  catalog_link_created_subscription: buildMatrix({
    body: CATALOG_VARIABLES,
    button: CATALOG_BUTTON_VARIABLES,
    helpText: "Usa variables del checkout de catálogo para alta de suscripción. Evita links de cobro puntual o tokenización.",
    recommendedButtonLabel: "Link de catálogo"
  }),
  tokenization_link_created: buildMatrix({
    body: TOKENIZATION_VARIABLES,
    button: TOKENIZATION_BUTTON_VARIABLES,
    helpText: "Usa variables de tokenización o checkout automático de suscripción. Este evento no envía links de catálogo.",
    recommendedButtonLabel: "Link para autorizar débito"
  }),
  payment_link_created: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_BUTTON_VARIABLES,
    helpText: "Recomendado: usa 'Link creado por este evento'. Solo usa checkout automático si tu plantilla debe llevar al checkout público general, no al link puntual recién creado.",
    recommendedButtonLabel: "Link creado por este evento"
  }),
  payment_link_created_subscription: buildMatrix({
    body: SUBSCRIPTION_LINK_VARIABLES,
    button: SUBSCRIPTION_LINK_BUTTON_VARIABLES,
    helpText: "Recomendado: usa 'Link creado por este evento'. Usa la opción de suscripción solo si quieres mandar al checkout general de la suscripción en vez del link puntual generado.",
    recommendedButtonLabel: "Link creado por este evento"
  }),
  payment_success: buildMatrix({
    body: [],
    button: [],
    helpText: "Usa variables de cliente, suscripción y pago aprobado. Este evento normalmente no requiere botones.",
    recommendedButtonLabel: null
  }),
  payment_failed_link: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_BUTTON_VARIABLES,
    helpText: "Si el mensaje habla de volver a pagar este cobro específico, usa 'Link creado por este evento'. 'Pago único' significa checkout general de un cobro suelto, no el link puntual recién creado.",
    recommendedButtonLabel: "Link creado por este evento"
  }),
  payment_failed_subscription: buildMatrix({
    body: [...SUBSCRIPTION_LINK_VARIABLES, ...TOKENIZATION_VARIABLES],
    button: SUBSCRIPTION_RECOVERY_BUTTON_VARIABLES,
    helpText: "Para recuperar la suscripción, usa link de cobro si quieres cobrar ya. Usa tokenización si el mensaje pide autorizar o actualizar el método de pago.",
    recommendedButtonLabel: "Depende del mensaje: pagar o autorizar débito"
  })
};

const REMINDER_VARIABLE_MATRIX: Record<ReminderNotificationKey, TemplateVariableMatrix> = {
  reminder_due_link: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_BUTTON_VARIABLES,
    helpText: "Recordatorio previo para link de pago. Usa variables del cobro manual.",
    recommendedButtonLabel: "Link para pagar"
  }),
  reminder_due_subscription: buildMatrix({
    body: TOKENIZATION_VARIABLES,
    button: TOKENIZATION_BUTTON_VARIABLES,
    helpText: "Recordatorio previo para débito automático. Usa variables de tokenización o checkout automático de suscripción.",
    recommendedButtonLabel: "Link para autorizar débito"
  }),
  reminder_mora_link: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_BUTTON_VARIABLES,
    helpText: "Recordatorio en mora para link de pago. Usa variables del cobro manual.",
    recommendedButtonLabel: "Link para pagar"
  }),
  reminder_mora_subscription: buildMatrix({
    body: [...SUBSCRIPTION_LINK_VARIABLES, ...TOKENIZATION_VARIABLES],
    button: SUBSCRIPTION_RECOVERY_BUTTON_VARIABLES,
    helpText: "Recordatorio en mora para débito automático. Usa recuperación por tokenización o link de cobro de suscripción.",
    recommendedButtonLabel: "Depende del mensaje: pagar o autorizar débito"
  })
};

export const ALL_NOTIFICATION_VARIABLE_OPTIONS = dedupeOptions([
  ...CORE_MESSAGE_VARIABLES,
  ...LINK_PAYMENT_VARIABLES,
  ...SUBSCRIPTION_LINK_VARIABLES,
  ...TOKENIZATION_VARIABLES,
  ...CATALOG_VARIABLES,
  ...PLAN_BUTTON_VARIABLES,
  ...SUBSCRIPTION_LINK_BUTTON_VARIABLES,
  ...TOKENIZATION_BUTTON_VARIABLES,
  ...SUBSCRIPTION_RECOVERY_BUTTON_VARIABLES,
  ...CATALOG_BUTTON_VARIABLES
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
