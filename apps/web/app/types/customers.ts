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

export interface CustomerWithSubscriptions extends Customer {
  subscriptions?: Subscription[];
  payments?: Payment[];
}
