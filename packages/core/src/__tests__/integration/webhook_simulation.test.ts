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
import { PaymentStatus, SubscriptionStatus, WebhookProcessStatus } from "@prisma/client";
import { ensurePaymentRetryJob } from "../../services/retryJobScheduler";

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
  resolveSubscriptionCollectionMode: vi.fn(() => "AUTO_DEBIT")
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

vi.mock("../../services/billingCycles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/billingCycles")>();
  return {
    ...actual,
    attachPaymentToCycle: vi.fn(() => Promise.resolve({ ok: true })),
    attachPaymentToMatchingCycle: vi.fn(() => Promise.resolve({ ok: true })),
    ensureBillingCyclesForSubscriptions: vi.fn(() => Promise.resolve()),
    syncSubscriptionBillingSnapshot: vi.fn(() => Promise.resolve(null)),
    resolveSubscriptionBillingState: vi.fn(() => Promise.resolve(null))
  };
});

// Mock mínimo de Prisma
function createMockPrisma() {
  const store: any = {
    webhookEvent: { "evt-1": { id: "evt-1", tenantId: "tenant-1", payload: {}, processStatus: "RECEIVED" } },
    subscriptionPlan: [],
    customer: {},
    subscription: {},
    payment: {},
    paymentAttempt: {},
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
    paymentAttempt: {
      findFirst: async ({ where }: any) =>
        Object.values(store.paymentAttempt || {}).find((a: any) => !where?.reference || a.reference === where.reference) || null,
      create: async ({ data }: any) => {
        const id = data.id || `att-${Object.keys(store.paymentAttempt || {}).length + 1}`;
        store.paymentAttempt[id] = { id, ...data };
        return store.paymentAttempt[id];
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
      upsert: async ({ where, create, update }: any) => {
        const existing = Object.values(store.payment).find((p: any) => {
          if (where.wompiTransactionId) return p.wompiTransactionId === where.wompiTransactionId;
          if (where.wompiPaymentLinkId) return p.wompiPaymentLinkId === where.wompiPaymentLinkId;
          if (where.subscriptionCycleKey) return p.subscriptionCycleKey === where.subscriptionCycleKey;
          return false;
        }) as any;
        if (existing) {
          store.payment[existing.id] = { ...existing, ...update };
          return store.payment[existing.id];
        }
        const id = "pay-" + Math.random();
        store.payment[id] = { id, ...create };
        return store.payment[id];
      },
      update: async ({ where, data }: any) => {
        const existing = store.payment[where.id] || { id: where.id };
        store.payment[where.id] = { ...existing, ...data };
        return store.payment[where.id];
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
      findUnique: async ({ where }: any) => {
        if (where.email) return Object.values(store.customer).find((c: any) => c.email === where.email) || null;
        if (where.id) return store.customer[where.id] || null;
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        let rows = Object.values(store.customer);
        if (where?.email) rows = rows.filter((c: any) => c.email === where.email);
        if (where?.tenantId) rows = rows.filter((c: any) => c.tenantId === where.tenantId);
        if (where?.phone?.not === null) rows = rows.filter((c: any) => c.phone != null);
        if (where?.name?.contains) {
          const needle = String(where.name.contains || "").toLowerCase();
          rows = rows.filter((c: any) => String(c.name || "").toLowerCase().includes(needle));
        }
        return rows;
      },
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
      update: async ({ where, data }: any) => {
        const existing = store.subscription[where.id];
        if (!existing) return null;
        const next = { ...existing, ...data, updatedAt: new Date() };
        store.subscription[where.id] = next;
        return next;
      },
      updateMany: async ({ where, data }: any) => {
        const existing = store.subscription[where.id];
        if (!existing) return { count: 0 };
        const next = { ...existing, ...data };
        store.subscription[where.id] = next;
        return { count: 1 };
      },
      findMany: async ({ where }: any = {}) => {
        let rows = Object.values(store.subscription);
        if (where?.customerId?.in) {
          rows = rows.filter((s: any) => where.customerId.in.includes(s.customerId));
        }
        if (where?.tenantId) rows = rows.filter((s: any) => s.tenantId === where.tenantId);
        return rows;
      }
    },
    subscriptionBillingCycle: {
      findMany: async ({ where, orderBy, take }: any = {}) => {
        let rows = Object.values(store.subscriptionBillingCycle || {}) as any[];
        if (where?.subscriptionId) {
          if (typeof where.subscriptionId === "string") {
            rows = rows.filter((c: any) => c.subscriptionId === where.subscriptionId);
          } else if (Array.isArray(where.subscriptionId?.in)) {
            rows = rows.filter((c: any) => where.subscriptionId.in.includes(c.subscriptionId));
          }
        }
        if (where?.paymentId === null) rows = rows.filter((c: any) => !c.paymentId);
        if (where?.status?.not) rows = rows.filter((c: any) => c.status !== where.status.not);
        if (Array.isArray(orderBy)) {
          rows = rows.sort((a, b) => {
            for (const rule of orderBy) {
              const key = Object.keys(rule || {})[0];
              const dir = (rule as any)[key];
              if (!key) continue;
              const av = a[key];
              const bv = b[key];
              if (av == null && bv == null) continue;
              if (av == null) return dir === "asc" ? 1 : -1;
              if (bv == null) return dir === "asc" ? -1 : 1;
              if (av < bv) return dir === "asc" ? -1 : 1;
              if (av > bv) return dir === "asc" ? 1 : -1;
            }
            return 0;
          });
        } else if (orderBy?.cycleNumber === "asc") {
          rows = rows.sort((a, b) => (a.cycleNumber || 0) - (b.cycleNumber || 0));
        }
        if (typeof take === "number") rows = rows.slice(0, Math.max(0, take));
        return rows;
      },
      findUnique: async ({ where }: any) => {
        const key = where?.subscriptionId_cycleNumber;
        if (!key) return null;
        return Object.values(store.subscriptionBillingCycle || {}).find(
          (c: any) => c.subscriptionId === key.subscriptionId && c.cycleNumber === key.cycleNumber
        ) || null;
      },
      upsert: async ({ create }: any) => {
        const id = create.id || `cycle-${Math.random()}`;
        store.subscriptionBillingCycle = store.subscriptionBillingCycle || {};
        store.subscriptionBillingCycle[id] = { id, ...create };
        return store.subscriptionBillingCycle[id];
      }
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

test("processWompiEventLogic: match por nombre y monto guarda matchScore", async () => {
  const { db, store } = createMockPrisma();
  const customerId = "cust-1";
  store.customer[customerId] = { id: customerId, tenantId: "tenant-1", name: "Diana Velez" };
  store.subscription["sub-1"] = {
    id: "sub-1",
    tenantId: "tenant-1",
    customerId,
    cycleStartDay: 1,
    paymentDay: 1,
    paymentTiming: "EN_CURSO",
    graceDays: 1,
    plan: { priceInCents: 12000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 }
  };

  store.webhookEvent["evt-name"] = { id: "evt-name", tenantId: "tenant-1", payload: {}, processStatus: "RECEIVED" };
  store.webhookEvent["evt-name"].payload = {
    data: {
      transaction: {
        status: "PENDING",
        amount_in_cents: 12000,
        currency: "COP",
        customer_data: { full_name: "Diana Velez" }
      }
    }
  };

  await processWompiEventLogic("evt-name", db);
  const payments = Object.values(store.payment);
  expect(payments.length).toBe(1);
  expect((payments[0] as any).matchScore).toBe(70);
});

test("processWompiEventLogic: match por email/phone guarda matchScore", async () => {
  const { db, store } = createMockPrisma();
  const customerId = "cust-2";
  store.customer[customerId] = { id: customerId, tenantId: "tenant-1", name: "Cliente", email: "a@b.com", phone: "+57 3000000000" };
  store.subscription["sub-2"] = {
    id: "sub-2",
    tenantId: "tenant-1",
    customerId,
    cycleStartDay: 1,
    paymentDay: 1,
    paymentTiming: "EN_CURSO",
    graceDays: 1,
    plan: { priceInCents: 9000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 }
  };

  store.webhookEvent["evt-email"] = { id: "evt-email", tenantId: "tenant-1", payload: {}, processStatus: "RECEIVED" };
  store.webhookEvent["evt-email"].payload = {
    data: {
      transaction: {
        status: "PENDING",
        amount_in_cents: 9000,
        currency: "COP",
        customer_email: "a@b.com"
      }
    }
  };

  await processWompiEventLogic("evt-email", db);
  const payments = Object.values(store.payment);
  expect(payments.length).toBe(1);
  expect((payments[0] as any).matchScore).toBe(80);
});

test("processWompiEventLogic: procesa pago aprobado con ciclos pendientes sin romper el flujo", async () => {
  const { db, store } = createMockPrisma();
  const customerId = "cust-3";
  store.customer[customerId] = { id: customerId, tenantId: "tenant-1", name: "Cliente", email: "old@pay.com" };
  store.subscription["sub-3"] = {
    id: "sub-3",
    tenantId: "tenant-1",
    customerId,
    cycleStartDay: 1,
    paymentDay: 1,
    paymentTiming: "EN_CURSO",
    graceDays: 1,
    plan: { priceInCents: 15000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 }
  };
  store.subscriptionBillingCycle = {
    c1: { id: "c1", subscriptionId: "sub-3", cycleNumber: 1, paymentId: null },
    c2: { id: "c2", subscriptionId: "sub-3", cycleNumber: 2, paymentId: null }
  };

  store.webhookEvent["evt-oldest"] = { id: "evt-oldest", tenantId: "tenant-1", payload: {}, processStatus: "RECEIVED" };
  store.webhookEvent["evt-oldest"].payload = {
    data: {
      transaction: {
        status: "APPROVED",
        amount_in_cents: 15000,
        currency: "COP",
        customer_email: "old@pay.com"
      }
    }
  };

  await processWompiEventLogic("evt-oldest", db);
  expect(store.webhookEvent["evt-oldest"].processStatus).toBe(WebhookProcessStatus.PROCESSED);
  const payments = Object.values(store.payment);
  expect(payments.length).toBe(1);
  expect((payments[0] as any).status).toBe(PaymentStatus.APPROVED);
});

function inicioDeMesUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function sumarMesesUtc(d: Date, meses: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1));
}

test.skipIf(!process.env.DATABASE_URL)("processWompiEventLogic: agenda el siguiente cobro con dueAt del nuevo ciclo", async () => {
  const { db, store } = createMockPrisma();
  const customerId = "cust-4";
  // Anclado a hoy: con fechas fijas, el "ciclo siguiente" queda en el pasado
  // en cuanto avanza el calendario y la prueba se cae sola.
  const mesActual = inicioDeMesUtc(new Date());
  const mesSiguiente = sumarMesesUtc(mesActual, 1);
  const mesSubsiguiente = sumarMesesUtc(mesActual, 2);
  const vencimientoSiguiente = new Date(mesSiguiente.getTime() + 14 * 24 * 60 * 60 * 1000);
  const periodStart = mesActual;
  const periodEnd = mesSiguiente;

  store.customer[customerId] = { id: customerId, tenantId: "tenant-1", email: "advance@test.com" };
  store.subscription["sub-advance"] = {
    id: "sub-advance",
    tenantId: "tenant-1",
    customerId,
    cycleStartDay: 1,
    paymentDay: 15,
    paymentTiming: "EN_CURSO",
    graceDays: 2,
    status: SubscriptionStatus.PAST_DUE,
    createdAt: periodStart,
    plan: { priceInCents: 15000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 }
  };

  store.webhookEvent["evt-advance"] = { id: "evt-advance", tenantId: "tenant-1", payload: {}, processStatus: "RECEIVED" };
  store.webhookEvent["evt-advance"].payload = {
    data: {
      transaction: {
        id: "tx-advance-1",
        status: "APPROVED",
        amount_in_cents: 15000,
        currency: "COP",
        reference: "SUB_sub-advance_1",
        customer_email: "advance@test.com"
      }
    }
  };

  // Configure resolveSubscriptionBillingState to return the next collection cycle
  const { resolveSubscriptionBillingState } = await import("../../services/billingCycles");
  vi.mocked(resolveSubscriptionBillingState).mockResolvedValueOnce({
    subscription: store.subscription["sub-advance"] as any,
    cycles: [],
    activeCycle: null,
    collectionCycle: {
      id: "c-next", subscriptionId: "sub-advance", cycleNumber: 2,
      periodStartAt: mesSiguiente, periodEndAt: mesSubsiguiente,
      dueAt: vencimientoSiguiente, status: "PENDING" as any, paymentId: null
    } as any,
    oldestUnpaidCycle: null
  });

  await processWompiEventLogic("evt-advance", db);

  expect(vi.mocked(ensurePaymentRetryJob)).toHaveBeenCalledWith(
    expect.objectContaining({
      subscriptionId: "sub-advance",
      runAt: vencimientoSiguiente
    })
  );
  // El webhook agenda el cobro; devolver la suscripción a ACTIVE es tarea del
  // barrido ensureExpiredSubscriptions, no de este camino.
  expect(store.subscription["sub-advance"].status).toBe(SubscriptionStatus.PAST_DUE);
});
