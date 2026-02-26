declare module "@prisma/client" {
  export class PrismaClient {
    [key: string]: any;
    constructor(...args: any[]);
    $queryRaw<T = unknown>(...args: any[]): Promise<T>;
    $queryRawUnsafe<T = unknown>(...args: any[]): Promise<T>;
    $executeRaw<T = unknown>(...args: any[]): Promise<T>;
    $transaction<T = unknown>(...args: any[]): Promise<T>;
    $disconnect(): Promise<void>;
  }

  export namespace Prisma {
    // Minimal placeholder for JsonNull usage in code paths.
    const JsonNull: null;
  }

  export enum SubscriptionStatus {
    ACTIVE = "ACTIVE",
    PAST_DUE = "PAST_DUE",
    EXPIRED = "EXPIRED",
    CANCELED = "CANCELED",
    SUSPENDED = "SUSPENDED"
  }

  export enum PlanIntervalUnit {
    DAY = "DAY",
    WEEK = "WEEK",
    MONTH = "MONTH",
    CUSTOM = "CUSTOM"
  }

  export enum PlanType {
    manual_link = "manual_link",
    auto_subscription = "auto_subscription"
  }

  export enum PublicCheckoutKind {
    PLAN = "PLAN",
    SUBSCRIPTION = "SUBSCRIPTION"
  }

  export enum PaymentStatus {
    PENDING = "PENDING",
    APPROVED = "APPROVED",
    DECLINED = "DECLINED",
    ERROR = "ERROR",
    VOIDED = "VOIDED"
  }

  export enum CampaignStatus {
    DRAFT = "DRAFT",
    RUNNING = "RUNNING",
    PAUSED = "PAUSED",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED"
  }

  export enum CampaignSendStatus {
    PENDING = "PENDING",
    SENT = "SENT",
    FAILED = "FAILED",
    SKIPPED = "SKIPPED"
  }

  export enum WebhookProvider {
    WOMPI = "WOMPI"
  }

  export enum WebhookProcessStatus {
    RECEIVED = "RECEIVED",
    PROCESSED = "PROCESSED",
    FAILED = "FAILED",
    SKIPPED = "SKIPPED"
  }

  export enum ChatwootMessageType {
    PAYMENT_LINK = "PAYMENT_LINK",
    PAYMENT_CONFIRMED = "PAYMENT_CONFIRMED",
    EXPIRY_WARNING = "EXPIRY_WARNING",
    PAYMENT_FAILED = "PAYMENT_FAILED"
  }

  export enum MessageStatus {
    PENDING = "PENDING",
    SENT = "SENT",
    FAILED = "FAILED"
  }

  export enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR"
  }

  export enum CredentialProvider {
    WOMPI = "WOMPI",
    CHATWOOT = "CHATWOOT",
    SHOPIFY = "SHOPIFY"
  }

  export enum RetryJobType {
    PROCESS_WOMPI_EVENT = "PROCESS_WOMPI_EVENT",
    FORWARD_WOMPI_TO_SHOPIFY = "FORWARD_WOMPI_TO_SHOPIFY",
    SEND_CHATWOOT_MESSAGE = "SEND_CHATWOOT_MESSAGE",
    SUBSCRIPTION_REMINDER = "SUBSCRIPTION_REMINDER",
    PAYMENT_RETRY = "PAYMENT_RETRY",
    BILLING_MONTHLY_REPORT = "BILLING_MONTHLY_REPORT",
    SEND_CAMPAIGN = "SEND_CAMPAIGN",
    SYNC_SMART_LISTS = "SYNC_SMART_LISTS"
  }

  export enum RetryJobStatus {
    PENDING = "PENDING",
    RUNNING = "RUNNING",
    SUCCEEDED = "SUCCEEDED",
    FAILED = "FAILED",
    CANCELED = "CANCELED"
  }

  export enum SaUserRole {
    SUPER_ADMIN = "SUPER_ADMIN",
    ADMIN = "ADMIN",
    AGENT = "AGENT"
  }

  export enum SaPeriodType {
    monthly = "monthly",
    total = "total"
  }

  export enum SaPlanKind {
    MASTER = "MASTER",
    PRO = "PRO",
    ON_DEMAND = "ON_DEMAND"
  }
}
