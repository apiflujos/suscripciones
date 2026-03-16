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
