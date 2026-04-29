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
    label: "Catálogo enviado (link de pago)",
    trigger: "CATALOG_LINK_CREATED",
    chatwootType: "PAYMENT_LINK",
    paymentType: "PLAN"
  },
  {
    key: "catalog_link_created_subscription",
    label: "Catálogo enviado (suscripción · link de pago)",
    aliases: ["Catálogo enviado (suscripción)"],
    trigger: "CATALOG_LINK_CREATED",
    chatwootType: "PAYMENT_LINK",
    paymentType: "SUBSCRIPTION"
  },
  {
    key: "tokenization_link_created",
    label: "Tokenización enviada (débito automático)",
    aliases: ["Tokenización enviada"],
    trigger: "TOKENIZATION_LINK_CREATED",
    chatwootType: "PAYMENT_LINK"
  },
  {
    key: "payment_link_created",
    label: "Link de pago creado",
    trigger: "PAYMENT_LINK_CREATED",
    chatwootType: "PAYMENT_LINK",
    paymentType: "LINK"
  },
  {
    key: "payment_link_created_subscription",
    label: "Link de pago creado (suscripción)",
    trigger: "PAYMENT_LINK_CREATED",
    chatwootType: "PAYMENT_LINK",
    paymentType: "SUBSCRIPTION"
  },
  {
    key: "payment_success",
    label: "Pago exitoso",
    trigger: "PAYMENT_APPROVED",
    chatwootType: "PAYMENT_CONFIRMED"
  },
  {
    key: "payment_failed_link",
    label: "Pago fallido (link de pago)",
    trigger: "PAYMENT_DECLINED",
    chatwootType: "PAYMENT_FAILED",
    paymentType: "LINK"
  },
  {
    key: "payment_failed_subscription",
    label: "Pago fallido (débito automático)",
    trigger: "PAYMENT_DECLINED",
    chatwootType: "PAYMENT_FAILED",
    paymentType: "SUBSCRIPTION"
  }
];

export const REALTIME_NOTIFICATION_MAP = Object.fromEntries(
  REALTIME_NOTIFICATION_DEFINITIONS.map((definition) => [definition.key, definition])
) as Record<RealtimeNotificationKey, RealtimeNotificationDefinition>;
