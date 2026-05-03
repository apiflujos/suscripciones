import type { PlanOption } from "./ChangePlanButton";

export type CollectionMode = "AUTO_DEBIT" | "AUTO_LINK" | "MANUAL_LINK";

export type EstadoSimpleInfo = {
  label: string;
  class: string;
};

export type EstadoInfo = EstadoSimpleInfo & {
  key: "si" | "no" | "mora";
};

export type CollectionStatusArgs = {
  status: string;
  dueAt: unknown;
  graceDays?: number;
  collectionCyclePaid?: boolean;
  nowDate?: Date;
};

export type CardCollectionStateArgs = {
  status: string;
  dueAt: unknown;
  graceDays?: number;
  collectionCyclePaid?: boolean;
  nowTs?: number;
};

export type BadgeInfo = {
  heading: string;
  value: string;
  className: string;
  title?: string;
};

export type BillingPageSearchParams = Record<string, string | string[] | undefined>;

export type BillingPageContentProps = {
  searchParams?: Promise<BillingPageSearchParams>;
};

export type TenantOption = {
  id: string;
  name: string;
};

export type BillingRow = {
  id: string;
  planId: string;
  intervalUnit: string;
  intervalCount: number;
  planIntervalUnit: string;
  planIntervalCount: number;
  tenantId: string;
  productId: string;
  productName: string;
  tenantIds: string[];
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerTokenized: boolean;
  customerMetadata: Record<string, unknown>;
  identificacion: string;
  tipoTx: string;
  tipoPago: string;
  activo: boolean;
  status: string;
  estadoInfo: EstadoInfo;
  planName: string;
  planImageUrl: string;
  montoInCents: number;
  valorBaseInCents: number;
  totalInCents: number;
  moneda: string;
  cada: string;
  pagoAt: string | null;
  pagoTxId: string | null;
  pagoMonto: number | null;
  lastPaymentLink: unknown;
  vencimientoAt: string | null;
  periodoInicioAt: string | null;
  periodoFinAt: string | null;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: string;
  graceDays: number;
  daysLate: number;
  inGrace: boolean;
  inArrears: boolean;
  nextRetryAt: string | null;
  mode: string;
  canManualCharge?: boolean;
  canManualMarkPaid?: boolean;
  canManualUnmarkPaid?: boolean;
  manualChargeEnabled?: boolean;
  manualMarkPaidEnabled?: boolean;
  chargeDue?: boolean;
  lastPaidInCurrentPeriod: boolean;
  collectionCyclePaid: boolean;
  tenantName: string;
  currentShippingInCents: number;
  currentRequiresShipping: boolean;
  suspendDays?: number;
  cancelDays?: number;
};

export type BillingAction = (formData: FormData) => void | Promise<void>;

export type BillingCardActions = {
  chargeSubscriptionNow: BillingAction;
  markSubscriptionPaidManual: BillingAction;
  unmarkSubscriptionPaidManual: BillingAction;
  sendWhatsAppPaymentLink: BillingAction;
  sendWhatsAppTokenizationLink: BillingAction;
  mergeDuplicateSubscriptions: BillingAction;
  updateSubscriptionTenants: BillingAction;
  changeSubscriptionPlan: BillingAction;
  updateSubscriptionBillingSettings: BillingAction;
  deleteSubscription: BillingAction;
  suspendSubscription: BillingAction;
  cancelSubscription: BillingAction;
  resumeSubscription: BillingAction;
  activateSubscription: BillingAction;
};

export type BillingCardHelpers = {
  findCheckoutTemplateForRow: (kind: "PLAN" | "SUBSCRIPTION", row: BillingRow) => unknown;
  getPaymentLinkBlockedReason: (row: BillingRow) => string;
  getTokenizationBlockedReason: (row: BillingRow) => string;
  resolveDuplicateKey: (row: BillingRow) => string;
  resolveRowTokenUrl: (row: BillingRow, transientUrl?: string) => string;
  resolveRowCheckoutUrl: (row: BillingRow) => string;
  matchesTransientSubscription: (row: BillingRow) => boolean;
  duplicateCountByKey: Map<string, number>;
  duplicateKeepByKey: Map<string, BillingRow>;
};

export type BillingCardState = {
  chargeStatus: string;
  chargeError: string;
  chargeErrorDetails: string;
  actionSubscriptionId: string;
  checkoutCustomerId: string;
  checkoutUrl: string;
  tokenUrl: string;
  central: string;
  chargeDateScheduled: string;
  tenantsUpdated: string;
};

export type BillingCardData = {
  tenants: TenantOption[];
  planOptions: PlanOption[];
  notificationsTemplates: unknown[];
  notificationsRules: unknown[];
  returnTo: string;
  csrfToken: string;
};

export type BillingCardContext = {
  state: BillingCardState;
  data: BillingCardData;
  actions: BillingCardActions;
  helpers: BillingCardHelpers;
};
