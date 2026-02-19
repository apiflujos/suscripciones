/**
 * Test de integración simulado para la lógica de Webhooks de Wompi.
 * 
 * Requisitos de ejecución:
 * Este test utiliza `node:test` nativo con `--experimental-strip-types`.
 * Si encuentra errores de resolución de módulos (ERR_MODULE_NOT_FOUND) debido a imports sin extensión .js/.ts en el código fuente,
 * se recomienda ejecutarlo usando `tsx`:
 * 
 *   npx tsx --test apps/api/src/__tests__/integration/webhook_simulation.test.ts
 * 
 * Asegúrese de que las dependencias nativas (esbuild) estén correctamente instaladas para su plataforma (ej. `npm rebuild`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { processWompiEventLogic } from "../../jobs/handlers/processWompiEvent";
import { PaymentStatus, WebhookProcessStatus } from "@prisma/client";

// Mock mínimo de Prisma
function createMockPrisma() {
  const store: any = {
    webhookEvent: { "evt-1": { id: "evt-1", payload: {}, processStatus: "RECEIVED" } },
    subscriptionPlan: [],
    customer: {},
    subscription: {},
    payment: {},
    paymentLink: {},
    retryJob: [],
    systemLog: []
  };

  const db: any = {
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
        create: async ({ data }: any) => {
            const id = "cust-" + Math.random();
            store.customer[id] = { id, ...data };
            return store.customer[id];
        }
    },
    subscription: {
        create: async ({ data }: any) => {
            const id = "sub-" + Math.random();
            store.subscription[id] = { id, ...data };
            return store.subscription[id];
        },
        findUnique: async ({ where }: any) => store.subscription[where.id] || null
    },
    paymentLink: {
        upsert: async () => {} 
    },
    $transaction: async (fn: any) => fn(db) // Ejecutar directamente
  };

  return { db, store };
}

test("processWompiEventLogic: crea suscripción desde pago manual", async () => {
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
        customer_data: { full_name: "Test User" }
      }
    },
    timestamp: Date.now()
  };
  
  store.webhookEvent["evt-1"].payload = payload;

  // 2. Ejecutar lógica
  await processWompiEventLogic("evt-1", db);

  // 3. Verificar resultados
  const evt = store.webhookEvent["evt-1"];
  assert.equal(evt.processStatus, WebhookProcessStatus.PROCESSED);

  // Verificar cliente creado
  const customers = Object.values(store.customer);
  assert.equal(customers.length, 1);
  assert.equal((customers[0] as any).email, "test@example.com");

  // Verificar suscripción creada
  const subs = Object.values(store.subscription);
  assert.equal(subs.length, 1);
  assert.equal((subs[0] as any).planId, "plan-1");

  // Verificar pago registrado
  const payments = Object.values(store.payment);
  assert.equal(payments.length, 1);
  assert.equal((payments[0] as any).status, PaymentStatus.APPROVED);
});

test("processWompiEventLogic: detecta ambigüedad de precios", async () => {
    const { db, store } = createMockPrisma();
  
    // Dos planes con mismo precio
    store.subscriptionPlan.push(
      { id: "plan-A", priceInCents: 10000, currency: "COP", active: true, updatedAt: new Date() },
      { id: "plan-B", priceInCents: 10000, currency: "COP", active: true, updatedAt: new Date() }
    );
  
    const payload = {
      data: { transaction: { amount_in_cents: 10000, currency: "COP", customer_email: "a@b.com" } }
    };
    store.webhookEvent["evt-ambiguo"] = { id: "evt-ambiguo", payload, processStatus: "RECEIVED" };
  
    await processWompiEventLogic("evt-ambiguo", db);
  
    // Debería procesar (tomando el primero) pero el sistema de logs (que no estamos mockeando aquí explícitamente pero se llama)
    // recibiría el aviso. En este test unitario validamos que NO falle catastróficamente y cree una suscripción.
    const subs = Object.values(store.subscription);
    assert.equal(subs.length, 1);
});
