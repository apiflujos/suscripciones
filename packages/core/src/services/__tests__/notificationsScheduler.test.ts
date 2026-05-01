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
      periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
      dueAt: new Date("2026-04-15T00:00:00.000Z")
    }
  }))
}));

import { prisma } from "../../db/prisma";
import { subscriptionReminder } from "../../jobs/handlers/subscriptionReminder";

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

  it("programa SUBSCRIPTION_DUE como SUBSCRIPTION_REMINDER usando dueAt", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      customerId: "cus-1",
      currentCycle: 1,
      currentPeriodStartAt: new Date("2026-04-01T00:00:00.000Z"),
      currentPeriodEndAt: new Date("2026-05-01T00:00:00.000Z"),
      cycleStartDay: 1,
      paymentDay: 15,
      paymentTiming: "EN_CURSO",
      plan: { intervalUnit: "MONTH" }
    } as any);

    await scheduleSubscriptionDueNotifications({ subscriptionId: "sub-1" });

    expect(prisma.retryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: RetryJobType.SUBSCRIPTION_REMINDER
        })
      })
    );
  });

  it("programa PAYMENT_APPROVED como SUBSCRIPTION_REMINDER", async () => {
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
          type: RetryJobType.SUBSCRIPTION_REMINDER
        })
      })
    );
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
});
