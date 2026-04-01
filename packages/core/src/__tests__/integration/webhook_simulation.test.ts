/**
 * Test de integración simulado para la lógica de Webhooks de Wompi.
 * 
 * Requisitos de ejecución:
 * Este test se ejecuta con Vitest desde la raíz del repo:
 *
 *   npm run test
 */
import { test, expect, vi } from "vitest";
import { processWompiEventLogic } from "../../jobs/handlers/processWompiEvent";
import { PaymentStatus, WebhookProcessStatus } from "@prisma/client";

vi.mock("../../services/runtimeConfig", () => ({
  getPaymentsConfig: vi.fn(() =>
    Promise.resolve({
      autoReconcileUnlinkedPayments: true,
      acceptUnlinkedPayments: true,
      notifyWhatsappForUnlinkedPayments: true,
      includeUnlinkedPaymentsInMetrics: true
    })
  ),
  getShopifyForward: vi.fn(() => Promise.resolve({ enabled: false })),
  getWompiCheckoutLinkBaseUrl: vi.fn(() => Promise.resolve("https://checkout.wompi.co/l/"))
}));

vi.mock("../../services/systemLog", () => ({
  systemLog: vi.fn(() => Promise.resolve())
}));

vi.mock("../../services/notificationsScheduler", () => ({
  schedulePaymentStatusNotifications: vi.fn(() => Promise.resolve()),
  scheduleSubscriptionDueNotifications: vi.fn(() => Promise.resolve())
}));

vi.mock("../../services/superAdminApp", () => ({
  consumeApp: vi.fn(() => Promise.resolve())
}));

vi.mock("../../services/chatwootSync", () => ({
  syncChatwootAttributesForCustomer: vi.fn(() => Promise.resolve())
}));

vi.mock("../../services/tenantContext", () => ({
  getDefaultTenantId: vi.fn(() => Promise.resolve("tenant-1"))
}));

vi.mock("../../services/gamification", () => ({
  applyGamificationEvent: vi.fn(() => Promise.resolve()),
  GAMIFICATION_EVENT_KINDS: { PAYMENT_RECEIVED: "payment_received" }
}));

vi.mock("../../services/gamificationConfig", () => ({
  GAMIFICATION_WEIGHTS: {},
  moneyToPoints: vi.fn(() => 0)
}));

vi.mock("../../services/subscriptionMode", () => ({
  resolveSubscriptionCollectionMode: vi.fn(() => "auto")
}));

vi.mock("../../services/realtimePublisher", () => ({
  publishRealtime: vi.fn(() => Promise.resolve())
}));

vi.mock("../../services/retryJobScheduler", () => ({
  ensurePaymentRetryJob: vi.fn(() => Promise.resolve())
}));

vi.mock("../../lib/http", () => ({
  postJson: vi.fn(() => Promise.resolve({ ok: true }))
}));

// Mock mínimo de Prisma
function createMockPrisma() {
  const store: any = {
    webhookEvent: { "evt-1": { id: "evt-1", tenantId: "tenant-1", payload: {}, processStatus: "RECEIVED" } },
    subscriptionPlan: [],
    customer: {},
    subscription: {},
    payment: {},
    paymentLink: {},
    retryJob: [],
    systemLog: []
  };

  const db: any = {
    $queryRaw: async () => [{ locked: true }],
    webhookEvent: {
      findUnique: async ({ where }: any) => store.webhookEvent[where.id] || null,
      update: async ({ where, data }: any) => {
        if (store.webhookEvent[where.id]) {
          store.webhookEvent[where.id] = { ...store.webhookEvent[where.id], ...data };
        }
        return store.webhookEvent[where.id];
      }
    },
    payment: {
      findUnique: async ({ where }: any) => {
        if (where.wompiPaymentLinkId) {
            return Object.values(store.payment).find((p: any) => p.wompiPaymentLinkId === where.wompiPaymentLinkId) || null;
        }
        if (where.wompiTransactionId) {
            return Object.values(store.payment).find((p: any) => p.wompiTransactionId === where.wompiTransactionId) || null;
        }
        return null;
      },
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const id = "pay-" + Math.random();
        store.payment[id] = { id, ...data };
        return store.payment[id];
      },
      upsert: async ({ create }: any) => {
        const id = "pay-" + Math.random();
        store.payment[id] = { id, ...create };
        return store.payment[id];
      },
      update: async ({ where, data }: any) => {
          // Simplificado
          return { id: where.id, ...data };
      }
    },
    subscriptionPlan: {
      findMany: async ({ where }: any) => {
        return store.subscriptionPlan.filter((p: any) => 
            p.active && 
            p.priceInCents === where.priceInCents && 
            p.currency === where.currency
        );
      }
    },
    customer: {
        findUnique: async ({ where }: any) => Object.values(store.customer).find((c: any) => c.email === where.email) || null,
        findMany: async () => [],
        create: async ({ data }: any) => {
            const id = "cust-" + Math.random();
            store.customer[id] = { id, ...data };
            return store.customer[id];
        }
    },
    customerTenant: {
        findFirst: async () => null
    },
    subscription: {
        create: async ({ data }: any) => {
            const id = "sub-" + Math.random();
            store.subscription[id] = { id, ...data };
            return store.subscription[id];
        },
        findUnique: async ({ where }: any) => store.subscription[where.id] || null,
        findMany: async () => []
    },
    subscriptionBillingCycle: {
        findMany: async () => [],
        findUnique: async () => null,
        upsert: async () => null
    },
    paymentLink: {
        findUnique: async () => null,
        upsert: async () => {} 
    },
    $transaction: async (fn: any) => fn(db) // Ejecutar directamente
  };

  return { db, store };
}

test("processWompiEventLogic: registra pago manual sin suscripción", async () => {
  const { db, store } = createMockPrisma();

  // 1. Configurar datos
  store.subscriptionPlan.push({
    id: "plan-1",
    name: "Plan Básico",
    priceInCents: 5000000,
    currency: "COP",
    active: true,
    intervalUnit: "MONTH",
    intervalCount: 1,
    updatedAt: new Date()
  });

  const payload = {
    event: "transaction.updated",
    data: {
      transaction: {
        id: "tx-wompi-1",
        status: "APPROVED",
        amount_in_cents: 5000000,
        currency: "COP",
        reference: "pago_manual_ref",
        customer_email: "test@example.com",
        customer_data: { full_name: "Test User", phone_number: "+57 3000000000" }
      }
    },
    timestamp: Date.now()
  };
  
  store.webhookEvent["evt-1"].payload = payload;

  // 2. Ejecutar lógica
  await processWompiEventLogic("evt-1", db);

  // 3. Verificar resultados
  const evt = store.webhookEvent["evt-1"];
  expect(evt.processStatus).toBe(WebhookProcessStatus.PROCESSED);

  // Verificar cliente creado
  const customers = Object.values(store.customer);
  expect(customers.length).toBe(1);
  expect((customers[0] as any).email).toBe("test@example.com");

  // No debe crear suscripción automática en el fallback
  const subs = Object.values(store.subscription);
  expect(subs.length).toBe(0);

  // Verificar pago registrado
  const payments = Object.values(store.payment);
  expect(payments.length).toBe(1);
  expect((payments[0] as any).status).toBe(PaymentStatus.APPROVED);
});

test("processWompiEventLogic: procesa sin suscripción cuando el plan es ambiguo", async () => {
    const { db, store } = createMockPrisma();
  
    // Dos planes con mismo precio
    store.subscriptionPlan.push(
      { id: "plan-A", priceInCents: 10000, currency: "COP", active: true, updatedAt: new Date() },
      { id: "plan-B", priceInCents: 10000, currency: "COP", active: true, updatedAt: new Date() }
    );
  
    const payload = {
      data: {
        transaction: {
          amount_in_cents: 10000,
          currency: "COP",
          customer_email: "a@b.com",
          customer_data: { full_name: "Test User", phone_number: "+57 3000000000" }
        }
      }
    };
    store.webhookEvent["evt-ambiguo"] = { id: "evt-ambiguo", payload, processStatus: "RECEIVED" };
  
    await processWompiEventLogic("evt-ambiguo", db);
  
    const evt = store.webhookEvent["evt-ambiguo"];
    expect(evt.processStatus).toBe(WebhookProcessStatus.PROCESSED);
    const subs = Object.values(store.subscription);
    expect(subs.length).toBe(0);
    const payments = Object.values(store.payment);
    expect(payments.length).toBe(1);
});
