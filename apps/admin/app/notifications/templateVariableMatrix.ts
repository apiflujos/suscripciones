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

const GENERIC_MESSAGE_VARIABLES: NotificationVariableOption[] = [
  { label: "Nombre del cliente", value: "{{customer.name}}" },
  { label: "Correo electronico", value: "{{customer.email}}" },
  { label: "Telefono", value: "{{customer.phone}}" },
  { label: "Nombre del producto", value: "{{plan.name}}" },
  { label: "Precio del producto (pesos)", value: "{{plan.priceInPesos}}" },
  { label: "Moneda del producto", value: "{{plan.currency}}" },
  { label: "Monto del pago (pesos)", value: "{{payment.amountInPesos}}" },
  { label: "Moneda del pago", value: "{{payment.currency}}" },
  { label: "Estado del pago", value: "{{payment.status}}" },
  { label: "Referencia", value: "{{payment.reference}}" },
  { label: "Fecha de pago", value: "{{payment.paidAt}}" },
  { label: "Fecha de creacion del pago", value: "{{payment.createdAt}}" },
  { label: "Fecha de fallo del pago", value: "{{payment.failedAt}}" },
  { label: "Recurrencia · cada (cantidad)", value: "{{plan.intervalCount}}" },
  { label: "Recurrencia · unidad", value: "{{plan.intervalUnit}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_MESSAGE_VARIABLES: NotificationVariableOption[] = [
  { label: "Estado de la suscripcion", value: "{{subscription.status}}" },
  { label: "Ciclo activo", value: "{{subscription.activeCycleNumber}}" },
  { label: "Mes del ciclo activo", value: "{{subscription.activeCycleLabel}}" },
  { label: "Inicio del ciclo activo", value: "{{subscription.activeCycleStartAt}}" },
  { label: "Fin del ciclo activo", value: "{{subscription.activeCycleEndAt}}" },
  { label: "Ciclo de cobro", value: "{{subscription.collectionCycleNumber}}" },
  { label: "Mes del ciclo de cobro", value: "{{subscription.collectionCycleLabel}}" },
  { label: "Proximo cobro", value: "{{subscription.nextBillingDate}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const LINK_PAYMENT_VARIABLES: NotificationVariableOption[] = [
  { label: "URL publica de pago", value: "{{paymentLink.url}}", recommended: true }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_LINK_VARIABLES: NotificationVariableOption[] = [
  { label: "URL publica de pago", value: "{{paymentLink.url}}", recommended: true }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const TOKENIZATION_VARIABLES: NotificationVariableOption[] = [
  { label: "URL publica de tokenizacion", value: "{{tokenization.url}}", recommended: true }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const CATALOG_VARIABLES: NotificationVariableOption[] = [
  { label: "URL publica de catalogo", value: "{{catalog.url}}", recommended: true }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const PLAN_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "URL publica de pago", value: "{{paymentLink.url}}", recommended: true }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_LINK_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "URL publica de pago", value: "{{paymentLink.url}}", recommended: true }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const TOKENIZATION_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "URL publica de tokenizacion", value: "{{tokenization.url}}", recommended: true }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const SUBSCRIPTION_RECOVERY_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "URL publica de tokenizacion", value: "{{tokenization.url}}", recommended: true },
  { label: "URL publica de pago", value: "{{paymentLink.url}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const CATALOG_BUTTON_VARIABLES: NotificationVariableOption[] = [
  { label: "URL publica de catalogo", value: "{{catalog.url}}", recommended: true }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

const LINK_CYCLE_VARIABLES: NotificationVariableOption[] = [
  { label: "Mes del ciclo de cobro", value: "{{subscription.collectionCycleLabel}}" },
  { label: "Mes del ciclo activo", value: "{{subscription.activeCycleLabel}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

// Los recordatorios anuncian la fecha en que hay que pagar. Sin esta opción el
// desplegable solo ofrecía fechas del pago (pagado, creado, fallido), y quien
// configuró la plantilla terminó eligiendo "Fecha de pago": vacía siempre, porque
// cuando sale el recordatorio el pago todavía no está pagado.
const CYCLE_DUE_DATE_VARIABLES: NotificationVariableOption[] = [
  { label: "Proximo cobro", value: "{{subscription.nextBillingDate}}", recommended: true }
];

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
  core?: NotificationVariableOption[];
  body: NotificationVariableOption[];
  button: NotificationVariableOption[];
  helpText: string;
  recommendedButtonLabel?: string | null;
}): TemplateVariableMatrix {
  return {
    bodyVariables: dedupeOptions([...(args.core || GENERIC_MESSAGE_VARIABLES), ...args.body]),
    buttonVariables: dedupeOptions(args.button),
    helpText: args.helpText,
    recommendedButtonLabel: args.recommendedButtonLabel ?? null
  };
}

const SUBSCRIPTION_CORE = [...GENERIC_MESSAGE_VARIABLES, ...SUBSCRIPTION_MESSAGE_VARIABLES];

const REALTIME_VARIABLE_MATRIX: Record<RealtimeNotificationKey, TemplateVariableMatrix> = {
  catalog_link_created_plan: buildMatrix({
    core: GENERIC_MESSAGE_VARIABLES,
    body: [...CATALOG_VARIABLES, ...LINK_CYCLE_VARIABLES],
    button: CATALOG_BUTTON_VARIABLES,
    helpText: "Usa solo la URL publica de catalogo de este evento. No mezcles tokenizacion ni links de pago.",
    recommendedButtonLabel: "Link de catalogo"
  }),
  catalog_link_created_subscription: buildMatrix({
    core: SUBSCRIPTION_CORE,
    body: CATALOG_VARIABLES,
    button: CATALOG_BUTTON_VARIABLES,
    helpText: "Usa solo la URL publica de catalogo para alta de suscripcion. Evita links de pago o tokenizacion.",
    recommendedButtonLabel: "Link de catalogo"
  }),
  tokenization_link_created: buildMatrix({
    core: SUBSCRIPTION_CORE,
    body: TOKENIZATION_VARIABLES,
    button: TOKENIZATION_BUTTON_VARIABLES,
    helpText: "Usa solo la URL publica de tokenizacion. Este evento no debe mezclar pagos ni catalogo.",
    recommendedButtonLabel: "Link para autorizar debito"
  }),
  payment_link_created: buildMatrix({
    core: GENERIC_MESSAGE_VARIABLES,
    body: [...LINK_PAYMENT_VARIABLES, ...LINK_CYCLE_VARIABLES],
    button: PLAN_BUTTON_VARIABLES,
    helpText: "Usa solo la URL publica de pago creada para este evento. No uses variantes crudas ni checkouts generales.",
    recommendedButtonLabel: "Link para pagar"
  }),
  payment_link_created_subscription: buildMatrix({
    core: SUBSCRIPTION_CORE,
    body: SUBSCRIPTION_LINK_VARIABLES,
    button: SUBSCRIPTION_LINK_BUTTON_VARIABLES,
    helpText: "Usa solo la URL publica de pago creada para este evento de suscripcion.",
    recommendedButtonLabel: "Link para pagar"
  }),
  payment_success: buildMatrix({
    core: SUBSCRIPTION_CORE,
    body: [],
    button: [],
    helpText: "Usa variables de cliente, suscripcion y pago aprobado. Este evento normalmente no requiere botones.",
    recommendedButtonLabel: null
  }),
  payment_failed_link: buildMatrix({
    core: GENERIC_MESSAGE_VARIABLES,
    body: [...LINK_PAYMENT_VARIABLES, ...LINK_CYCLE_VARIABLES],
    button: PLAN_BUTTON_VARIABLES,
    helpText: "Si el mensaje pide reintentar el pago, usa solo la URL publica de pago.",
    recommendedButtonLabel: "Link para pagar"
  }),
  payment_failed_subscription: buildMatrix({
    core: SUBSCRIPTION_CORE,
    body: [...SUBSCRIPTION_LINK_VARIABLES, ...TOKENIZATION_VARIABLES],
    button: SUBSCRIPTION_RECOVERY_BUTTON_VARIABLES,
    helpText: "Para recuperar la suscripcion usa una URL publica valida: tokenizacion si debes autorizar debito, o pago si debes cobrar ahora.",
    recommendedButtonLabel: "Pagar o autorizar debito"
  })
};

const REMINDER_VARIABLE_MATRIX: Record<ReminderNotificationKey, TemplateVariableMatrix> = {
  reminder_due_link: buildMatrix({
    core: GENERIC_MESSAGE_VARIABLES,
    body: [...CYCLE_DUE_DATE_VARIABLES, ...LINK_PAYMENT_VARIABLES, ...LINK_CYCLE_VARIABLES],
    button: PLAN_BUTTON_VARIABLES,
    helpText: "Recordatorio previo de pago. Para la fecha usa \"Proximo cobro\": las fechas del pago están vacías porque todavía no se pagó. Usa solo la URL publica de pago.",
    recommendedButtonLabel: "Link para pagar"
  }),
  reminder_due_subscription: buildMatrix({
    core: SUBSCRIPTION_CORE,
    body: TOKENIZATION_VARIABLES,
    button: TOKENIZATION_BUTTON_VARIABLES,
    helpText: "Recordatorio previo de debito automatico. Usa solo la URL publica de tokenizacion.",
    recommendedButtonLabel: "Link para autorizar debito"
  }),
  reminder_mora_link: buildMatrix({
    core: GENERIC_MESSAGE_VARIABLES,
    body: [...CYCLE_DUE_DATE_VARIABLES, ...LINK_PAYMENT_VARIABLES, ...LINK_CYCLE_VARIABLES],
    button: PLAN_BUTTON_VARIABLES,
    helpText: "Recordatorio en mora. Usa solo la URL publica de pago.",
    recommendedButtonLabel: "Link para pagar"
  }),
  reminder_mora_subscription: buildMatrix({
    core: SUBSCRIPTION_CORE,
    body: [...SUBSCRIPTION_LINK_VARIABLES, ...TOKENIZATION_VARIABLES],
    button: SUBSCRIPTION_RECOVERY_BUTTON_VARIABLES,
    helpText: "Recordatorio en mora para debito automatico. Usa tokenizacion o pago, pero siempre con URL publica.",
    recommendedButtonLabel: "Pagar o autorizar debito"
  })
};

export const ALL_NOTIFICATION_VARIABLE_OPTIONS = dedupeOptions([
  ...GENERIC_MESSAGE_VARIABLES,
  ...SUBSCRIPTION_MESSAGE_VARIABLES,
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
