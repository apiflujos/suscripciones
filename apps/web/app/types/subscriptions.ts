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
