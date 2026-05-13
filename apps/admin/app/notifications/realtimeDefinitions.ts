import type {
  NotificationPaymentType,
  NotificationTrigger
} from "@suscripciones/core/services/notificationsConfig";

export type RealtimeNotificationKey =
  | "catalog_link_created_plan"
  | "catalog_link_created_subscription"
  | "tokenization_link_created"
  | "payment_link_created"
  | "payment_link_created_subscription"
  | "payment_success"
  | "payment_failed_link"
  | "payment_failed_subscription";

export type RealtimeChatwootType =
  | "PAYMENT_LINK"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_FAILED";

export type RealtimeNotificationDefinition = {
  key: RealtimeNotificationKey;
  label: string;
  aliases?: string[];
  trigger: NotificationTrigger;
  chatwootType: RealtimeChatwootType;
  paymentType?: NotificationPaymentType;
};

export const REALTIME_NOTIFICATION_DEFINITIONS: RealtimeNotificationDefinition[] = [
  {
    key: "catalog_link_created_plan",
    label: "Link de catalogo enviado",
    trigger: "CATALOG_LINK_CREATED",
    chatwootType: "PAYMENT_LINK",
    paymentType: "PLAN"
  },
  {
    key: "catalog_link_created_subscription",
    label: "Link de catalogo enviado (suscripcion)",
    aliases: ["Link de catalogo enviado (alta de suscripcion)"],
    trigger: "CATALOG_LINK_CREATED",
    chatwootType: "PAYMENT_LINK",
    paymentType: "SUBSCRIPTION"
  },
  {
    key: "tokenization_link_created",
    label: "Link de tokenizacion enviado (debito automatico)",
    aliases: ["Tokenizacion enviada"],
    trigger: "TOKENIZATION_LINK_CREATED",
    chatwootType: "PAYMENT_LINK"
  },
  {
    key: "payment_link_created",
    label: "Link de pago enviado",
    trigger: "PAYMENT_LINK_CREATED",
    chatwootType: "PAYMENT_LINK",
    paymentType: "LINK"
  },
  {
    key: "payment_link_created_subscription",
    label: "Link de pago enviado (suscripcion)",
    trigger: "PAYMENT_LINK_CREATED",
    chatwootType: "PAYMENT_LINK",
    paymentType: "SUBSCRIPTION"
  },
  {
    key: "payment_success",
    label: "Pago aprobado",
    trigger: "PAYMENT_APPROVED",
    chatwootType: "PAYMENT_CONFIRMED"
  },
  {
    key: "payment_failed_link",
    label: "Pago rechazado (link publico de pago)",
    trigger: "PAYMENT_DECLINED",
    chatwootType: "PAYMENT_FAILED",
    paymentType: "LINK"
  },
  {
    key: "payment_failed_subscription",
    label: "Pago rechazado (debito automatico)",
    trigger: "PAYMENT_DECLINED",
    chatwootType: "PAYMENT_FAILED",
    paymentType: "SUBSCRIPTION"
  }
];

export const REALTIME_NOTIFICATION_MAP = Object.fromEntries(
  REALTIME_NOTIFICATION_DEFINITIONS.map((definition) => [definition.key, definition])
) as Record<RealtimeNotificationKey, RealtimeNotificationDefinition>;
