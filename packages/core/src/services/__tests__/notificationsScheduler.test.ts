import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryJobType } from "@prisma/client";
import {
  scheduleCatalogLinkNotifications,
  schedulePaymentLinkNotifications,
  schedulePaymentStatusNotifications,
  scheduleSubscriptionDueNotifications,
  scheduleTokenizationLinkNotifications
} from "../notificationsScheduler";
import { getNotificationsConfig } from "../notificationsConfig";
import { systemLog } from "../systemLog";

vi.mock("../../db/prisma", () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    payment: { findUnique: vi.fn() },
    retryJob: { findFirst: vi.fn(), create: vi.fn() }
  }
}));

vi.mock("../notificationsConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../notificationsConfig")>();
  return {
    ...actual,
    getNotificationsConfig: vi.fn(async () => ({
      rules: [
        { id: "rule-1", enabled: true, trigger: "SUBSCRIPTION_DUE", offsetsSeconds: [60] },
        { id: "rule-2", enabled: true, trigger: "PAYMENT_APPROVED", offsetsSeconds: [60] },
        { id: "rule-3", enabled: true, trigger: "PAYMENT_LINK_CREATED", offsetsSeconds: [60] },
        { id: "rule-4", enabled: true, trigger: "TOKENIZATION_LINK_CREATED", offsetsSeconds: [60] },
        { id: "rule-5", enabled: true, trigger: "CATALOG_LINK_CREATED", offsetsSeconds: [60, 120] }
      ],
      templates: []
    })),
    getNotificationsActiveEnv: vi.fn(async () => "PRODUCTION")
  };
});

vi.mock("../runtimeConfig", () => ({
  getAppTimeZone: vi.fn(async () => "America/Bogota"),
  getPaymentsConfig: vi.fn(async () => ({
    autoReconcileUnlinkedPayments: true,
    acceptUnlinkedPayments: true,
    notifyWhatsappForUnlinkedPayments: true,
    includeUnlinkedPaymentsInMetrics: true
  }))
}));

vi.mock("../systemLog", () => ({
  systemLog: vi.fn(async () => undefined),
  SystemActor: { SYSTEM: "system" }
}));

vi.mock("../publicBase", () => ({
  normalizePublicUrl: vi.fn((value?: string | null) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(raw)) return "";
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  })
}));

vi.mock("../../jobs/handlers/subscriptionReminder", () => ({
  subscriptionReminder: vi.fn(async () => ({ ok: true }))
}));

vi.mock("../webhooks/wompi/classifyReference", () => ({
  classifyReference: vi.fn(() => ({ kind: "subscription" }))
}));

vi.mock("../billingCycles", () => ({
  resolveSubscriptionBillingState: vi.fn(async () => ({
    subscription: { plan: { metadata: { collectionMode: "AUTO_DEBIT" } } },
    collectionCycle: {
      cycleNumber: 1,
      periodEndAt: new Date(Date.now() + 17 * 24 * 60 * 60 * 1000),
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  }))
}));

import { prisma } from "../../db/prisma";
import { subscriptionReminder } from "../../jobs/handlers/subscriptionReminder";
import { resolveSubscriptionBillingState } from "../billingCycles";

describe("notificationsScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [
        { id: "rule-1", enabled: true, trigger: "SUBSCRIPTION_DUE", offsetsSeconds: [60] },
        { id: "rule-2", enabled: true, trigger: "PAYMENT_APPROVED", offsetsSeconds: [60] },
        { id: "rule-3", enabled: true, trigger: "PAYMENT_LINK_CREATED", offsetsSeconds: [60] },
        { id: "rule-4", enabled: true, trigger: "TOKENIZATION_LINK_CREATED", offsetsSeconds: [60] },
        { id: "rule-5", enabled: true, trigger: "CATALOG_LINK_CREATED", offsetsSeconds: [60, 120] }
      ],
      templates: []
    } as any);
    vi.mocked(prisma.retryJob.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.retryJob.create).mockResolvedValue({ id: "job-1" } as any);
  });

  it("filtra reglas PAYMENT_LINK_CREATED por tipo SUBSCRIPTION cuando el pago pertenece a una suscripción", async () => {
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "AUTO_DEBIT" } } }
    } as any);
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [
        { id: "rule-link", enabled: true, trigger: "PAYMENT_LINK_CREATED", offsetsSeconds: [60], conditions: { requirePaymentTypeIn: ["LINK"] } },
        { id: "rule-sub", enabled: true, trigger: "PAYMENT_LINK_CREATED", offsetsSeconds: [60], conditions: { requirePaymentTypeIn: ["SUBSCRIPTION"] } }
      ],
      templates: []
    } as any);
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay-1",
      customerId: "cus-1",
      subscriptionId: "sub-1"
    } as any);

    await schedulePaymentLinkNotifications({ paymentId: "pay-1" });

    expect(prisma.retryJob.create).toHaveBeenCalledTimes(1);
    expect(prisma.retryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            ruleId: "rule-sub"
          })
        })
      })
    );
  });

  it("filtra reglas PAYMENT_LINK_CREATED por tipo LINK cuando el pago no pertenece a una suscripción", async () => {
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [
        { id: "rule-link", enabled: true, trigger: "PAYMENT_LINK_CREATED", offsetsSeconds: [60], conditions: { requirePaymentTypeIn: ["LINK"] } },
        { id: "rule-sub", enabled: true, trigger: "PAYMENT_LINK_CREATED", offsetsSeconds: [60], conditions: { requirePaymentTypeIn: ["SUBSCRIPTION"] } }
      ],
      templates: []
    } as any);
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay-1",
      customerId: "cus-1",
      subscriptionId: null
    } as any);

    await schedulePaymentLinkNotifications({ paymentId: "pay-1" });

    expect(prisma.retryJob.create).toHaveBeenCalledTimes(1);
    expect(prisma.retryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            ruleId: "rule-link"
          })
        })
      })
    );
  });

  it("filtra reglas PAYMENT_LINK_CREATED por tipo LINK cuando la suscripción usa AUTO_LINK", async () => {
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "AUTO_LINK" } } }
    } as any);
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [
        { id: "rule-link", enabled: true, trigger: "PAYMENT_LINK_CREATED", offsetsSeconds: [60], conditions: { requirePaymentTypeIn: ["LINK"] } },
        { id: "rule-sub", enabled: true, trigger: "PAYMENT_LINK_CREATED", offsetsSeconds: [60], conditions: { requirePaymentTypeIn: ["SUBSCRIPTION"] } }
      ],
      templates: []
    } as any);
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay-1",
      customerId: "cus-1",
      subscriptionId: "sub-1"
    } as any);

    await schedulePaymentLinkNotifications({ paymentId: "pay-1" });

    expect(prisma.retryJob.create).toHaveBeenCalledTimes(1);
    expect(prisma.retryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            ruleId: "rule-link",
            paymentType: "LINK"
          })
        })
      })
    );
  });

  it("programa SUBSCRIPTION_DUE como SUBSCRIPTION_REMINDER usando dueAt", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      customerId: "cus-1"
    } as any);
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "AUTO_DEBIT" } } },
      collectionCycle: {
        cycleNumber: 1,
        periodEndAt: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    } as any);
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [
        { id: "rule-sub", enabled: true, trigger: "SUBSCRIPTION_DUE", offsetsSeconds: [60], conditions: { requirePaymentTypeIn: ["SUBSCRIPTION"] } }
      ],
      templates: []
    } as any);

    await scheduleSubscriptionDueNotifications({ subscriptionId: "sub-1" });

    expect(prisma.retryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: RetryJobType.SUBSCRIPTION_REMINDER,
          payload: expect.objectContaining({
            ruleId: "rule-sub"
          })
        })
      })
    );
  });

  it("no deja que un job cancelado bloquee la reprogramación del aviso", async () => {
    // Guardar la configuración de cobros cancela los avisos pendientes y los vuelve
    // a agendar. Si la búsqueda de duplicados no filtra por estado, encuentra el que
    // acaba de cancelar y no crea el nuevo: el ciclo se queda sin avisar.
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: "sub-1", customerId: "cus-1" } as any);
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "MANUAL_LINK" } } },
      collectionCycle: {
        cycleNumber: 1,
        periodEndAt: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    } as any);
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [{ id: "rule-antes", enabled: true, trigger: "SUBSCRIPTION_DUE", offsetsSeconds: [-3600] }],
      templates: []
    } as any);

    await scheduleSubscriptionDueNotifications({ subscriptionId: "sub-1" });

    const consulta = vi.mocked(prisma.retryJob.findFirst).mock.calls[0]?.[0] as any;
    expect(consulta).toBeDefined();
    expect(consulta.where.status.in).toEqual(
      expect.arrayContaining(["PENDING", "RUNNING", "SUCCEEDED"])
    );
    expect(consulta.where.status.in).not.toContain("CANCELED");
    expect(consulta.where.status.in).not.toContain("FAILED");
  });

  it("no agenda un recordatorio anticipado si el vencimiento ya pasó", async () => {
    // El texto anuncia una fecha futura ("está programado para el día X").
    // Mandarlo después de esa fecha sería mentirle al cliente.
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: "sub-1", customerId: "cus-1" } as any);
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "MANUAL_LINK" } } },
      collectionCycle: {
        cycleNumber: 1,
        periodEndAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      }
    } as any);
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [
        { id: "rule-antes", enabled: true, trigger: "SUBSCRIPTION_DUE", offsetsSeconds: [-86400] }
      ],
      templates: []
    } as any);

    const res = await scheduleSubscriptionDueNotifications({ subscriptionId: "sub-1" });

    expect(prisma.retryJob.create).not.toHaveBeenCalled();
    expect(res.scheduled).toBe(0);
  });

  it("no agenda avisos cuyo momento de envío quedó muy atrás", async () => {
    // Al agendar ciclos viejos, sin este tope una sola pasada dispararía de golpe
    // una avalancha de avisos vencidos a toda la cartera.
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: "sub-1", customerId: "cus-1" } as any);
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "MANUAL_LINK" } } },
      collectionCycle: {
        cycleNumber: 1,
        periodEndAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      }
    } as any);
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [
        { id: "rule-mora", enabled: true, trigger: "SUBSCRIPTION_DUE", offsetsSeconds: [432000] }
      ],
      templates: []
    } as any);

    const res = await scheduleSubscriptionDueNotifications({ subscriptionId: "sub-1" });

    expect(prisma.retryJob.create).not.toHaveBeenCalled();
    expect(res.scheduled).toBe(0);
  });

  it("sí agenda la mora cuando el momento de envío todavía no llegó", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: "sub-1", customerId: "cus-1" } as any);
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "MANUAL_LINK" } } },
      collectionCycle: {
        cycleNumber: 4,
        periodEndAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      }
    } as any);
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [
        { id: "rule-mora", enabled: true, trigger: "SUBSCRIPTION_DUE", offsetsSeconds: [432000] }
      ],
      templates: []
    } as any);

    const res = await scheduleSubscriptionDueNotifications({ subscriptionId: "sub-1" });

    expect(res.scheduled).toBe(1);
    expect(prisma.retryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: expect.objectContaining({ ruleId: "rule-mora" }) })
      })
    );
  });

  it("filtra SUBSCRIPTION_DUE por tipo LINK cuando la suscripción no usa AUTO_DEBIT", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      customerId: "cus-1"
    } as any);
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "MANUAL_LINK" } } },
      collectionCycle: {
        cycleNumber: 1,
        periodEndAt: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    } as any);
    vi.mocked(getNotificationsConfig).mockResolvedValue({
      rules: [
        { id: "rule-link", enabled: true, trigger: "SUBSCRIPTION_DUE", offsetsSeconds: [60], conditions: { requirePaymentTypeIn: ["LINK"] } },
        { id: "rule-sub", enabled: true, trigger: "SUBSCRIPTION_DUE", offsetsSeconds: [60], conditions: { requirePaymentTypeIn: ["SUBSCRIPTION"] } }
      ],
      templates: []
    } as any);

    await scheduleSubscriptionDueNotifications({ subscriptionId: "sub-1" });

    expect(prisma.retryJob.create).toHaveBeenCalledTimes(1);
    expect(prisma.retryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            ruleId: "rule-link"
          })
        })
      })
    );
  });

  it("envia SUBSCRIPTION_DUE inline cuando forceNow=true", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      customerId: "cus-1"
    } as any);

    const result = await scheduleSubscriptionDueNotifications({ subscriptionId: "sub-1", forceNow: true });

    expect(vi.mocked(subscriptionReminder)).toHaveBeenCalledTimes(1);
    expect(result.sentNow).toBe(1);
    expect(result.scheduled).toBe(0);
  });

  it("programa PAYMENT_APPROVED como SUBSCRIPTION_REMINDER", async () => {
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "AUTO_LINK" } } }
    } as any);
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay-1",
      customerId: "cus-1",
      subscriptionId: "sub-1",
      status: "APPROVED",
      providerResponse: {},
      reference: "SUB_sub-1_1"
    } as any);

    await schedulePaymentStatusNotifications({ paymentId: "pay-1" });

    expect(prisma.retryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: RetryJobType.SUBSCRIPTION_REMINDER,
          payload: expect.objectContaining({
            paymentType: "LINK"
          })
        })
      })
    );
  });

  it("envia PAYMENT_APPROVED inline cuando forceNow=true y reporta sentNow", async () => {
    vi.mocked(resolveSubscriptionBillingState).mockResolvedValue({
      subscription: { plan: { metadata: { collectionMode: "AUTO_DEBIT" } } }
    } as any);
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay-1",
      customerId: "cus-1",
      subscriptionId: "sub-1",
      status: "APPROVED",
      providerResponse: {},
      reference: "SUB_sub-1_1"
    } as any);

    const result = await schedulePaymentStatusNotifications({ paymentId: "pay-1", forceNow: true });

    expect(vi.mocked(subscriptionReminder)).toHaveBeenCalledTimes(1);
    expect(result.sentNow).toBe(1);
    expect(result.scheduled).toBe(0);
  });

  it("programa PAYMENT_LINK_CREATED y TOKENIZATION_LINK_CREATED como SUBSCRIPTION_REMINDER", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay-1",
      customerId: "cus-1",
      subscriptionId: "sub-1"
    } as any);

    await schedulePaymentLinkNotifications({ paymentId: "pay-1" });
    await scheduleTokenizationLinkNotifications({ customerId: "cus-1", tokenUrl: "https://example.com/t" });

    expect(vi.mocked(prisma.retryJob.create).mock.calls.every((call) => call[0]?.data?.type === RetryJobType.SUBSCRIPTION_REMINDER)).toBe(true);
  });

  it("normaliza paymentLinkUrl antes de guardarlo en el payload", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay-1",
      customerId: "cus-1",
      subscriptionId: null
    } as any);

    await schedulePaymentLinkNotifications({ paymentId: "pay-1", paymentLinkUrl: "mdv.sus.apiflujos.com/public/plan/abc" });

    expect(prisma.retryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            paymentLinkUrl: "https://mdv.sus.apiflujos.com/public/plan/abc"
          })
        })
      })
    );
  });

  it("marca tokenization forceNow sin entrega cuando no se envia nada", async () => {
    vi.mocked(subscriptionReminder).mockResolvedValue({ ok: false } as any);

    const result = await scheduleTokenizationLinkNotifications({ customerId: "cus-1", tokenUrl: "https://example.com/t", forceNow: true });

    expect(result.sentNow).toBe(0);
    expect(result.errors).toEqual(["chatwoot_send_failed"]);
    expect(systemLog).toHaveBeenCalledWith(
      "WARN",
      "notifications.schedule",
      "Notificaciones sin entrega",
      expect.objectContaining({
        trigger: "TOKENIZATION_LINK_CREATED",
        customerId: "cus-1",
        sentNow: 0
      }),
      expect.anything()
    );
  });

  it("descarta tokenUrl localhost antes de programar", async () => {
    const result = await scheduleTokenizationLinkNotifications({
      customerId: "cus-1",
      tokenUrl: "http://localhost:3008/public/suscripcion/token"
    });

    expect(result.scheduled).toBe(0);
    expect(prisma.retryJob.create).not.toHaveBeenCalled();
  });

  it("envia catalogo forceNow una sola vez y devuelve errores", async () => {
    vi.mocked(subscriptionReminder).mockResolvedValue({ ok: false, error: "customer_phone_required" } as any);

    const result = await scheduleCatalogLinkNotifications({
      customerId: "cus-1",
      catalogUrl: "https://example.com/cart",
      paymentType: "PLAN",
      forceNow: true
    });

    expect(vi.mocked(subscriptionReminder)).toHaveBeenCalledTimes(1);
    expect(result.sentNow).toBe(0);
    expect(result.errors).toEqual(["customer_phone_required"]);
  });

  it("normaliza catalogUrl antes del envio inmediato", async () => {
    await scheduleCatalogLinkNotifications({
      customerId: "cus-1",
      catalogUrl: "mdv.sus.apiflujos.com/public/cart/abc",
      paymentType: "PLAN",
      forceNow: true
    });

    expect(vi.mocked(subscriptionReminder)).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogUrl: "https://mdv.sus.apiflujos.com/public/cart/abc"
      })
    );
  });
});
