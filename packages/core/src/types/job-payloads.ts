export type ProcessWompiEventPayload = { webhookEventId: string };

export type PaymentRetryPayload = { subscriptionId: string };

export type SubscriptionReminderPayload =
  | {
      trigger: "SUBSCRIPTION_DUE";
      ruleId: string;
      customerId: string;
      subscriptionId: string;
      cycleNumber: number;
      anchorAt: string;
      paymentId?: string;
      offsetSeconds?: number;
      immediateSend?: boolean;
    }
  | {
      trigger: "PAYMENT_APPROVED" | "PAYMENT_DECLINED";
      ruleId: string;
      customerId: string;
      paymentId: string;
      paymentStatus: "PENDING" | "APPROVED" | "DECLINED" | "ERROR" | "VOIDED";
      anchorAt: string;
      subscriptionId?: string;
      offsetSeconds?: number;
      immediateSend?: boolean;
    }
  | {
      trigger: "PAYMENT_LINK_CREATED";
      ruleId: string;
      customerId: string;
      paymentId: string;
      anchorAt: string;
      paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK";
      subscriptionId?: string;
      offsetSeconds?: number;
      immediateSend?: boolean;
    }
  | {
      trigger: "CATALOG_LINK_CREATED";
      ruleId: string;
      customerId: string;
      catalogUrl: string;
      anchorAt: string;
      paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK";
      subscriptionId?: string;
      paymentId?: string;
      offsetSeconds?: number;
      immediateSend?: boolean;
    }
  | {
      trigger: "TOKENIZATION_LINK_CREATED";
      ruleId: string;
      customerId: string;
      tokenUrl: string;
      anchorAt: string;
      subscriptionId?: string;
      paymentId?: string;
      offsetSeconds?: number;
      immediateSend?: boolean;
    };

export type ForwardToShopifyPayload = { webhookEventId: string };

export type BillingReportPayload = { periodKey: string };

export type SendCampaignPayload = { campaignId?: string; reason?: string };

export type SyncSmartListsPayload = { reason?: string };

export type GamificationRecalcPayload = {
  reason?: string;
  scope?: "customers" | "products" | "all";
  tenantId?: string;
};

export type AiAssistPayload = Record<string, unknown>;

export type DataTrainerPayload = Record<string, unknown>;

export type SendChatwootMessagePayload = { chatwootMessageId: string };
