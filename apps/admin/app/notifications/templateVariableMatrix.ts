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
  { label: "Correo del cliente", value: "{{customer.email}}" },
  { label: "Teléfono del cliente", value: "{{customer.phone}}" },
  { label: "Nombre de la suscripción o servicio", value: "{{plan.name}}" },
  { label: "Valor de la suscripción o servicio", value: "{{plan.priceInPesos}}" },
  { label: "Moneda de la suscripción o servicio", value: "{{plan.currency}}" },
  { label: "Monto a cobrar", value: "{{payment.amountInPesos}}" },
  { label: "Moneda del cobro", value: "{{payment.currency}}" },
  { label: "Estado del pago", value: "{{payment.status}}" },
  { label: "Referencia del pago", value: "{{payment.reference}}" },
  { label: "Estado de la suscripción", value: "{{subscription.status}}" },
  { label: "Ciclo activo", value: "{{subscription.activeCycleNumber}}" },
  { label: "Inicio del ciclo activo", value: "{{subscription.activeCycleStartAt}}" },
  { label: "Fin del ciclo activo", value: "{{subscription.activeCycleEndAt}}" },
  { label: "Ciclo de cobro", value: "{{subscription.collectionCycleNumber}}" },
  { label: "Próximo vencimiento", value: "{{subscription.nextBillingDate}}" },
  { label: "Fecha en que se pagó", value: "{{payment.paidAt}}" },
  { label: "Fecha en que se creó el cobro", value: "{{payment.createdAt}}" },
  { label: "Fecha en que falló el cobro", value: "{{payment.failedAt}}" },
  { label: "Frecuencia · cada cuántos periodos", value: "{{plan.intervalCount}}" },
  { label: "Frecuencia · unidad de tiempo", value: "{{plan.intervalUnit}}" },
  { label: "Modo de cobro", value: "{{paymentType}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const LINK_PAYMENT_VARIABLES: NotificationVariableOption[] = [
  { label: "Link para pagar", value: "{{paymentLink.url}}", recommended: true },
  { label: "Link alterno para pagar (automático del evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Link alterno para pagar · compra puntual", value: "{{checkoutPublicUrl.AUTO_PLAN}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_LINK_VARIABLES: NotificationVariableOption[] = [
  { label: "Link para pagar", value: "{{paymentLink.url}}", recommended: true },
  { label: "Link alterno para pagar (automático del evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Link alterno para pagar · suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const TOKENIZATION_VARIABLES: NotificationVariableOption[] = [
  { label: "Link de autorización actual", value: "{{tokenizationLink.url}}" },
  { label: "Link para autorizar débito", value: "{{tokenization.url}}", recommended: true },
  { label: "Link alterno para autorizar (automático del evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Link alterno para autorizar · suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const CATALOG_VARIABLES: NotificationVariableOption[] = [
  { label: "Link de catálogo actual", value: "{{cartLink.url}}" },
  { label: "Link de catálogo", value: "{{catalog.url}}", recommended: true },
  { label: "Link alterno de catálogo (automático del evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Link alterno de catálogo · checkout público", value: "{{checkoutPublicUrl.AUTO_CART}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const PLAN_TOKEN_VARIABLES: NotificationVariableOption[] = [
  { label: "Botón recomendado · Pagar ahora", value: "{{checkoutPublicToken.AUTO}}", recommended: true },
  { label: "Botón alterno · Pagar compra puntual", value: "{{checkoutPublicToken.AUTO_PLAN}}" },
  { label: "Link para pagar", value: "{{paymentLink.url}}" },
  { label: "Link alterno para pagar (automático del evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Link alterno para pagar · compra puntual", value: "{{checkoutPublicUrl.AUTO_PLAN}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_TOKEN_VARIABLES: NotificationVariableOption[] = [
  { label: "Botón recomendado · Continuar con este flujo", value: "{{checkoutPublicToken.AUTO}}", recommended: true },
  { label: "Botón alterno · Flujo de suscripción", value: "{{checkoutPublicToken.AUTO_SUBSCRIPTION}}" },
  { label: "Link para pagar", value: "{{paymentLink.url}}" },
  { label: "Link de autorización actual", value: "{{tokenizationLink.url}}" },
  { label: "Link para autorizar débito", value: "{{tokenization.url}}" },
  { label: "Link alterno del evento", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Link alterno · suscripción", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const CATALOG_TOKEN_VARIABLES: NotificationVariableOption[] = [
  { label: "Botón recomendado · Abrir catálogo", value: "{{checkoutPublicToken.AUTO}}", recommended: true },
  { label: "Botón alterno · Checkout de catálogo", value: "{{checkoutPublicToken.AUTO_CART}}" },
  { label: "Link de catálogo actual", value: "{{cartLink.url}}" },
  { label: "Link de catálogo", value: "{{catalog.url}}" },
  { label: "Link alterno de catálogo (automático del evento)", value: "{{checkoutPublicUrl.AUTO}}" },
  { label: "Link alterno de catálogo · checkout público", value: "{{checkoutPublicUrl.AUTO_CART}}" }
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
    button: CATALOG_TOKEN_VARIABLES,
    helpText: "Usa variables de catálogo. Este evento no debería usar links de tokenización ni de cobro de suscripción.",
    recommendedButtonLabel: "Link de catálogo"
  }),
  catalog_link_created_subscription: buildMatrix({
    body: CATALOG_VARIABLES,
    button: CATALOG_TOKEN_VARIABLES,
    helpText: "Usa variables del checkout de catálogo para alta de suscripción. Evita links de cobro puntual o tokenización.",
    recommendedButtonLabel: "Link de catálogo"
  }),
  tokenization_link_created: buildMatrix({
    body: TOKENIZATION_VARIABLES,
    button: SUBSCRIPTION_TOKEN_VARIABLES,
    helpText: "Usa variables de tokenización o checkout automático de suscripción. Este evento no envía links de catálogo.",
    recommendedButtonLabel: "Link para autorizar débito"
  }),
  payment_link_created: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_TOKEN_VARIABLES,
    helpText: "Usa variables del link de cobro puntual. Este evento no corresponde a débito automático ni catálogo.",
    recommendedButtonLabel: "Link para pagar"
  }),
  payment_link_created_subscription: buildMatrix({
    body: SUBSCRIPTION_LINK_VARIABLES,
    button: SUBSCRIPTION_TOKEN_VARIABLES,
    helpText: "Usa variables del link de cobro de una suscripción por link. No mezcles catálogo ni tokenización aislada.",
    recommendedButtonLabel: "Link para pagar"
  }),
  payment_success: buildMatrix({
    body: [],
    button: [],
    helpText: "Usa variables de cliente, suscripción y pago aprobado. Este evento normalmente no requiere botones.",
    recommendedButtonLabel: null
  }),
  payment_failed_link: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_TOKEN_VARIABLES,
    helpText: "Usa variables de reintento para cobro puntual. No mezcles catálogo ni links de tokenización.",
    recommendedButtonLabel: "Link para pagar"
  }),
  payment_failed_subscription: buildMatrix({
    body: [...SUBSCRIPTION_LINK_VARIABLES, ...TOKENIZATION_VARIABLES],
    button: SUBSCRIPTION_TOKEN_VARIABLES,
    helpText: "Usa variables de recuperación de suscripción: link de cobro o tokenización, según tu plantilla.",
    recommendedButtonLabel: "Depende del mensaje: pagar o autorizar débito"
  })
};

const REMINDER_VARIABLE_MATRIX: Record<ReminderNotificationKey, TemplateVariableMatrix> = {
  reminder_due_link: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_TOKEN_VARIABLES,
    helpText: "Recordatorio previo para pago puntual. Usa variables del cobro puntual.",
    recommendedButtonLabel: "Link para pagar"
  }),
  reminder_due_subscription: buildMatrix({
    body: TOKENIZATION_VARIABLES,
    button: SUBSCRIPTION_TOKEN_VARIABLES,
    helpText: "Recordatorio previo para débito automático. Usa variables de tokenización o checkout automático de suscripción.",
    recommendedButtonLabel: "Link para autorizar débito"
  }),
  reminder_mora_link: buildMatrix({
    body: LINK_PAYMENT_VARIABLES,
    button: PLAN_TOKEN_VARIABLES,
    helpText: "Recordatorio en mora para pago puntual. Usa variables del cobro puntual.",
    recommendedButtonLabel: "Link para pagar"
  }),
  reminder_mora_subscription: buildMatrix({
    body: [...SUBSCRIPTION_LINK_VARIABLES, ...TOKENIZATION_VARIABLES],
    button: SUBSCRIPTION_TOKEN_VARIABLES,
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
