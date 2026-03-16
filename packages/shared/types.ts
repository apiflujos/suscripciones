/**
 * Tipos Compartidos - API y Admin
 * 
 * Este archivo contiene los tipos que usan tanto el backend (API) 
 * como el frontend (Admin) para mantener consistencia.
 */

// ============================================================================
// PAGOS
// ============================================================================

export type PaymentStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'ERROR' | 'VOIDED';

export type PaymentSource = 'SHOPIFY' | 'ALEGRA' | 'MANUAL' | 'DIRECT';

export interface Payment {
  id: string;
  tenantId: string;
  customerId: string;
  subscriptionId?: string;
  amountInCents: number;
  currency: string;
  reference: string;
  wompiTransactionId?: string;
  wompiPaymentLinkId?: string;
  checkoutUrl?: string;
  status: PaymentStatus;
  paidAt?: string;
  failedAt?: string;
  providerResponse?: any;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentLink {
  id: string;
  tenantId: string;
  planId: string;
  subscriptionId: string;
  checkoutUrl: string;
  status: string;
  sentAt?: string;
  paidAt?: string;
  createdAt: string;
}

// ============================================================================
// CLIENTES
// ============================================================================

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerWithRelations extends Customer {
  subscriptions?: Subscription[];
  payments?: Payment[];
}

// ============================================================================
// SUSCRIPCIONES
// ============================================================================

export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELED' | 'SUSPENDED';

export type PlanType = 'manual_link' | 'auto_subscription';

export type IntervalUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';

export interface SubscriptionPlan {
  id: string;
  tenantId: string;
  name: string;
  priceInCents: number;
  currency: string;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  planType: PlanType;
  collectionMode?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  tenantId: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  startAt: string;
  currentPeriodStartAt: string;
  currentPeriodEndAt: string;
  currentCycle: number;
  retryCount: number;
  maxRetries: number;
  canceledAt?: string;
  suspendedAt?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  plan?: SubscriptionPlan;
  customer?: Customer;
}

// ============================================================================
// PRODUCTOS
// ============================================================================

export type ProductKind = 'PRODUCT' | 'SERVICE';

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  sku?: string;
  kind: ProductKind;
  basePriceInCents: number;
  currency: string;
  requiresShipping?: boolean;
  shippingInCents?: number;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// USUARIOS / TENANTS
// ============================================================================

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'AGENT';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  tenantId?: string;
  createdAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// RESPUESTAS API
// ============================================================================

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  skip?: number;
  take?: number;
}

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

export interface PaymentsConfig {
  autoReconcileUnlinkedPayments: boolean;
  acceptUnlinkedPayments: boolean;
  notifyWhatsappForUnlinkedPayments: boolean;
  includeUnlinkedPaymentsInMetrics: boolean;
}

export interface CheckoutConfig {
  planBaseUrl?: string;
  subscriptionBaseUrl?: string;
  defaultUtmParams?: string;
  tokenExpiryHours?: number;
  logoUrl?: string;
  supportEmail?: string;
  supportUrl?: string;
}

// ============================================================================
// WEBHOOKS
// ============================================================================

export type WebhookProvider = 'WOMPI' | 'CHATWOOT' | 'SHOPIFY';

export type WebhookProcessStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export interface WebhookEvent {
  id: string;
  provider: WebhookProvider;
  eventName: string;
  payload: any;
  processStatus: WebhookProcessStatus;
  processError?: string;
  receivedAt: string;
  processedAt?: string;
}

// ============================================================================
// JOBS / RETRIES
// ============================================================================

export type RetryJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type RetryJobType = 
  | 'PROCESS_WOMPI_EVENT'
  | 'FORWARD_WOMPI_TO_SHOPIFY'
  | 'SUBSCRIPTION_REMINDER'
  | 'SEND_CHATWOOT_MESSAGE'
  | 'PAYMENT_RETRY'
  | 'BILLING_MONTHLY_REPORT'
  | 'SEND_CAMPAIGN'
  | 'SYNC_SMART_LISTS'
  | 'AI_ASSIST'
  | 'GAMIFICATION_RECALC'
  | 'DATA_TRAINER';

export interface RetryJob {
  id: string;
  type: RetryJobType;
  status: RetryJobStatus;
  payload: any;
  runAt: string;
  runAttemp: number;
  maxAttempts: number;
  error?: string;
  completedAt?: string;
  createdAt: string;
}

// ============================================================================
// NOTIFICACIONES
// ============================================================================

export type NotificationTrigger = 
  | 'SUBSCRIPTION_DUE'
  | 'PAYMENT_LINK_CREATED'
  | 'CATALOG_LINK_CREATED'
  | 'TOKENIZATION_LINK_CREATED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_DECLINED';

export type NotificationChannel = 'CHATWOOT' | 'META';

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: NotificationChannel;
  content?: string;
  chatwootType?: string;
  chatwootTemplate?: any;
}

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: NotificationTrigger;
  templateId: string;
  offsetsSeconds?: number[];
  atTimeUtc?: string;
  ensurePaymentLink?: boolean;
  conditions?: any;
}
