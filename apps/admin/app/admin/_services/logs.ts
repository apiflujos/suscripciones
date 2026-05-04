import "server-only";

import { prisma } from "@suscripciones/database";
import { logger } from "@suscripciones/core/lib/logger";
import { Prisma, RetryJobStatus, WebhookProcessStatus, WebhookProvider } from "@prisma/client";
import { getDefaultTenantId } from "@suscripciones/core/services/tenantContext";
import { getWompiEventsSecret } from "@suscripciones/core/services/runtimeConfig";
import { ensureBillingCyclesForSubscriptions } from "@suscripciones/core/services/billingCycles";
import { buildSystemLogWhere, defaultFromDate, parseDate, pickProviderFailureMessage, stringOrNull } from "../logs/_lib";

export async function listPaymentLogs(args: {
  take?: number;
  skip?: number;
  q?: string;
  ids?: string[];
  status?: string;
  from?: string;
  to?: string;
  tenantId?: string;
  planId?: string;
  productId?: string;
  includeIgnored?: boolean;
  withCount?: boolean;
}) {
  const withCount = Boolean(args.withCount);
  const take = Math.min(200, Math.max(1, Number(args.take ?? 20)));
  const skip = Math.max(0, Number(args.skip ?? 0));
  const q = String(args.q ?? "").trim();
  const ids = Array.isArray(args.ids) ? args.ids.filter((v) => /^[0-9a-fA-F-]{36}$/.test(v)) : [];
  const statusRaw = String(args.status ?? "").trim().toUpperCase();
  const fromRaw = String(args.from ?? "").trim();
  const toRaw = String(args.to ?? "").trim();
  const tenantId = String(args.tenantId ?? "").trim();
  const planId = String(args.planId ?? "").trim();
  const productId = String(args.productId ?? "").trim();

  const statusFilter =
    statusRaw === "APPROVED"
      ? ["APPROVED"]
      : statusRaw === "PENDING"
        ? ["PENDING", "PROCESSING"]
        : statusRaw === "FAILED"
          ? ["DECLINED", "ERROR", "VOIDED"]
          : statusRaw === "RECEIVED"
            ? ["APPROVED", "DECLINED", "ERROR", "VOIDED"]
            : statusRaw === "REQUESTED"
              ? ["PENDING", "PROCESSING"]
              : null;

  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw, { end: true });

  const dateRange = {
    gte: fromDate,
    ...(toDate ? { lt: toDate } : {})
  };
  const dateWhere: Prisma.PaymentWhereInput =
    statusRaw === "APPROVED"
      ? {
          OR: [
            { paidAt: dateRange },
            {
              paidAt: null,
              createdAt: dateRange
            }
          ]
        }
      : statusRaw === "FAILED"
        ? {
            OR: [
              { failedAt: dateRange },
              {
                failedAt: null,
                createdAt: dateRange
              }
            ]
          }
        : statusRaw === "RECEIVED"
          ? {
              OR: [
                { paidAt: dateRange },
                { failedAt: dateRange },
                { createdAt: dateRange }
              ]
            }
          : statusRaw === "REQUESTED"
            ? { createdAt: dateRange }
      : {
          OR: [{ createdAt: dateRange }, { paidAt: dateRange }, { failedAt: dateRange }]
        };

  const whereBase: Prisma.PaymentWhereInput = {
    ...(statusFilter ? { status: { in: statusFilter as any } } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(planId ? { subscription: { planId } } : {}),
    ...(productId
      ? {
          subscription: {
            ...(planId ? { planId } : {}),
            OR: [{ productId }, { plan: { catalogProductId: productId } }]
          }
        }
      : {}),
    ...dateWhere,
    ...(q
      ? {
          OR: [
            { reference: { contains: q, mode: "insensitive" } },
            { wompiTransactionId: { contains: q, mode: "insensitive" } },
            { wompiPaymentLinkId: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { customer: { email: { contains: q, mode: "insensitive" } } },
            { customer: { phone: { contains: q, mode: "insensitive" } } },
            { subscription: { product: { name: { contains: q, mode: "insensitive" } } } },
            { subscription: { plan: { name: { contains: q, mode: "insensitive" } } } }
          ]
        }
      : {})
  };
  const where = ids.length ? ({ ...whereBase, id: { in: ids } } as Prisma.PaymentWhereInput) : whereBase;
  const include = {
    subscription: { include: { plan: true, product: true, customer: true } },
    customer: true,
    billingCycle: {
      select: {
        id: true,
        cycleNumber: true,
        status: true,
        dueAt: true,
        periodStartAt: true,
        periodEndAt: true
      }
    },
    attempts: { orderBy: { createdAt: "desc" }, take: 1 }
  } as const;

  let items: any[] = [];
  let total: number | null = null;

  const [found, counted] = await Promise.all([
    prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      take,
      skip,
      where,
      include
    }),
    withCount ? prisma.payment.count({ where }) : Promise.resolve(null)
  ]);
  items = found;
  total = counted;

  const paymentIds = items.map((item: any) => String(item.id || "")).filter(Boolean);
  const subscriptionIds = items.map((item: any) => String(item.subscriptionId || "")).filter(Boolean);
  const customerIds = items.map((item: any) => String(item.customerId || "")).filter(Boolean);
  const chatwootMessages = paymentIds.length || subscriptionIds.length
    ? await prisma.chatwootMessage.findMany({
        where: {
          OR: [
            paymentIds.length ? { paymentId: { in: paymentIds } } : undefined,
            subscriptionIds.length ? { subscriptionId: { in: subscriptionIds } } : undefined
          ].filter(Boolean) as Prisma.ChatwootMessageWhereInput[],
          type: { in: ["PAYMENT_LINK", "EXPIRY_WARNING"] }
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          paymentId: true,
          subscriptionId: true,
          type: true,
          status: true,
          sentAt: true,
          createdAt: true,
          providerResp: true
        }
      })
    : [];

  const activeSubscriptions = customerIds.length
    ? await prisma.subscription.findMany({
        where: {
          customerId: { in: Array.from(new Set(customerIds)) },
          status: { in: ["ACTIVE", "PAST_DUE"] as any[] },
          ...(tenantId ? { tenantId } : {})
        },
        select: {
          id: true,
          tenantId: true,
          customerId: true,
          status: true,
          startAt: true,
          cycleStartDay: true,
          paymentDay: true,
          paymentTiming: true,
          graceDays: true,
          plan: { select: { name: true, intervalUnit: true, intervalCount: true } }
        }
      })
    : [];
  if (activeSubscriptions.length) {
    await ensureBillingCyclesForSubscriptions(
      activeSubscriptions.map((s) => ({
        id: s.id,
        startAt: s.startAt,
        cycleStartDay: (s as any).cycleStartDay ?? 1,
        paymentDay: (s as any).paymentDay ?? 1,
        paymentTiming: String((s as any).paymentTiming || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO",
        graceDays: (s as any).graceDays ?? 1,
        plan: { intervalUnit: (s as any).plan?.intervalUnit, intervalCount: (s as any).plan?.intervalCount }
      }))
    ).catch((err) => {
      logger.warn({ err, subscriptionIds: activeSubscriptions.map((s) => s.id) }, "logs service: fallo asegurando ciclos para resumen de pagos");
    });
  }
  const cycles = activeSubscriptions.length
    ? await prisma.subscriptionBillingCycle.findMany({
        where: { subscriptionId: { in: activeSubscriptions.map((s) => s.id) } },
        orderBy: { periodStartAt: "desc" }
      })
    : [];
  const cyclesBySubscription = new Map<string, typeof cycles>();
  for (const c of cycles) {
    if (!cyclesBySubscription.has(c.subscriptionId)) cyclesBySubscription.set(c.subscriptionId, []);
    cyclesBySubscription.get(c.subscriptionId)!.push(c);
  }
  const subsByCustomerTenant = new Map<string, typeof activeSubscriptions>();
  const planBySubscription = new Map<string, string>();
  for (const sub of activeSubscriptions) {
    const key = `${sub.customerId}:${sub.tenantId}`;
    if (!subsByCustomerTenant.has(key)) subsByCustomerTenant.set(key, []);
    subsByCustomerTenant.get(key)!.push(sub);
    planBySubscription.set(sub.id, String((sub as any).plan?.name || "Plan"));
  }

  const notificationByPaymentId = new Map<string, any>();
  const notificationBySubscriptionId = new Map<string, any>();
  for (const msg of chatwootMessages) {
    if (msg.paymentId && !notificationByPaymentId.has(msg.paymentId)) notificationByPaymentId.set(msg.paymentId, msg);
    if (msg.subscriptionId && !notificationBySubscriptionId.has(msg.subscriptionId)) notificationBySubscriptionId.set(msg.subscriptionId, msg);
  }

  const mappedItems = items.map((item: any) => {
    const lastAttempt = Array.isArray(item.attempts) ? item.attempts[0] : null;
    const failureCode = stringOrNull(lastAttempt?.errorCode) || stringOrNull(lastAttempt?.status) || null;
    const failureReason = stringOrNull(lastAttempt?.errorMessage) || pickProviderFailureMessage(item.providerResponse) || null;
    const reconciliation =
      (item?.providerResponse && typeof item.providerResponse === "object" ? (item.providerResponse as any).reconciliation : null) || null;
    const isIgnoredExternal = String(reconciliation?.status || "").toUpperCase() === "IGNORED_EXTERNAL";
    const notification =
      (item.id && notificationByPaymentId.get(String(item.id))) ||
      (item.subscriptionId && notificationBySubscriptionId.get(String(item.subscriptionId))) ||
      null;
    const candidateSubscriptions = subsByCustomerTenant.get(`${item.customerId}:${item.tenantId}`) || [];
    const candidateCyclesSource = item.subscriptionId
      ? (cyclesBySubscription.get(String(item.subscriptionId)) || []).map((c) => ({
          ...c,
          planName: planBySubscription.get(String(item.subscriptionId)) || "Plan"
        }))
      : candidateSubscriptions.flatMap((s) =>
          (cyclesBySubscription.get(s.id) || []).map((c) => ({
            ...c,
            planName: planBySubscription.get(s.id) || "Plan"
          }))
        );
    const candidateCycles = candidateCyclesSource
      .filter((cycle) => String(cycle.status || "").toUpperCase() !== "PAID" || String(cycle.paymentId || "") === String(item.id || ""))
      .sort((a, b) => {
        const dueDiff = new Date(a.dueAt || a.periodEndAt).getTime() - new Date(b.dueAt || b.periodEndAt).getTime();
        if (dueDiff !== 0) return dueDiff;
        return Number(a.cycleNumber || 0) - Number(b.cycleNumber || 0);
      });
    const resolvedProductId =
      String(item.subscription?.productId || "").trim() ||
      String((item.subscription?.plan as any)?.catalogProductId || item.subscription?.plan?.metadata?.catalog?.itemId || "").trim() ||
      null;
    const resolvedProductName = String(item.subscription?.product?.name || "").trim() || String(item.subscription?.plan?.name || "").trim() || null;
    return {
      ...item,
      productId: resolvedProductId,
      productName: resolvedProductName,
      failureCode,
      failureReason,
      reconciliation,
      isIgnoredExternal,
      notification,
      candidateSubscriptions,
      candidateCycles
    };
  });

  return { items: mappedItems, total };
}

export async function listSystemLogs(args: {
  take?: number;
  skip?: number;
  q?: string;
  level?: string;
  customerId?: string;
  from?: string;
  to?: string;
  ids?: string[];
  withCount?: boolean;
}) {
  const withCount = Boolean(args.withCount);
  const take = Math.min(200, Math.max(1, Number(args.take ?? 20)));
  const skip = Math.max(0, Number(args.skip ?? 0));
  const q = String(args.q ?? "").trim();
  const level = String(args.level ?? "").trim().toUpperCase();
  const customerId = String(args.customerId ?? "").trim();
  const fromRaw = String(args.from ?? "").trim();
  const toRaw = String(args.to ?? "").trim();
  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw, { end: true });
  const ids = Array.isArray(args.ids) ? args.ids.filter((v) => /^[0-9a-fA-F-]{36}$/.test(v)) : [];

  const finalWhere = buildSystemLogWhere({ q, level, customerId, fromDate, toDate, ids });

  const [items, total] = await Promise.all([
    prisma.systemLog.findMany({
      where: finalWhere,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: { id: true, level: true, source: true, message: true, context: true, actor: true, createdAt: true }
    }),
    withCount ? prisma.systemLog.count({ where: finalWhere }) : Promise.resolve(null)
  ]);

  const subscriptionIds = new Set<string>();
  const customerIds = new Set<string>();
  const planIds = new Set<string>();
  const productIds = new Set<string>();
  const paymentIds = new Set<string>();
  const webhookIds = new Set<string>();

  for (const item of items) {
    const ctx: any = item.context || {};
    if (ctx.subscriptionId) subscriptionIds.add(String(ctx.subscriptionId));
    if (ctx.customerId) customerIds.add(String(ctx.customerId));
    if (ctx.planId) planIds.add(String(ctx.planId));
    if (ctx.productId) productIds.add(String(ctx.productId));
    if (ctx.paymentId) paymentIds.add(String(ctx.paymentId));
    if (ctx.webhookEventId) webhookIds.add(String(ctx.webhookEventId));
  }

  const [subscriptions, customers, plans, products, payments, webhooks] = await Promise.all([
    subscriptionIds.size
      ? prisma.subscription.findMany({
          where: { id: { in: Array.from(subscriptionIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } },
            productId: true,
            product: { select: { name: true } },
            plan: { select: { name: true } }
          }
        })
      : Promise.resolve([]),
    customerIds.size
      ? prisma.customer.findMany({
          where: { id: { in: Array.from(customerIds) } },
          select: { id: true, name: true, email: true, phone: true }
        })
      : Promise.resolve([]),
    planIds.size
      ? prisma.subscriptionPlan.findMany({
          where: { id: { in: Array.from(planIds) } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
    productIds.size
      ? prisma.subscriptionPlan.findMany({
          where: { id: { in: Array.from(productIds) } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
    paymentIds.size
      ? prisma.payment.findMany({
          where: { id: { in: Array.from(paymentIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } },
            subscription: {
              select: {
                productId: true,
                product: { select: { name: true } },
                plan: { select: { name: true } }
              }
            }
          }
        })
      : Promise.resolve([]),
    webhookIds.size
      ? prisma.webhookEvent.findMany({ where: { id: { in: Array.from(webhookIds) } }, select: { id: true, eventName: true } })
      : Promise.resolve([])
  ]);

  const subById = new Map(subscriptions.map((s) => [String(s.id), s]));
  const customerById = new Map(customers.map((c) => [String(c.id), c]));
  const planById = new Map(plans.map((p) => [String(p.id), p]));
  const productById = new Map(products.map((p) => [String(p.id), p]));
  const paymentById = new Map(payments.map((p) => [String(p.id), p]));
  const webhookById = new Map(webhooks.map((w) => [String(w.id), w]));

  function inferActor(item: any) {
    if (item.actor) return String(item.actor);
    const ctx: any = item.context || {};
    const candidate = ctx.actor || ctx.actorEmail || ctx.userEmail || ctx.adminEmail || ctx.user || ctx.email;
    if (candidate) return String(candidate);
    const source = String(item.source || "");
    if (source.startsWith("webhooks.")) return "Webhook";
    if (source.startsWith("jobs.") || source.startsWith("notifications.") || source.startsWith("process")) return "Sistema";
    if (source.startsWith("chatwoot.") || source.startsWith("smart_lists.")) return "Sistema";
    return "Admin API";
  }

  function formatEntity(item: any) {
    const ctx: any = item.context || {};
    if (ctx.paymentId && paymentById.has(String(ctx.paymentId))) {
      const p = paymentById.get(String(ctx.paymentId)) as any;
      const customer = p.customer?.name || p.customer?.email || p.customer?.phone || p.customerId;
      const product = p.subscription?.product?.name || p.subscription?.plan?.name;
      return `Pago · ${customer}${product ? ` · ${product}` : ""}`;
    }
    if (ctx.subscriptionId && subById.has(String(ctx.subscriptionId))) {
      const s = subById.get(String(ctx.subscriptionId)) as any;
      const customer = s.customer?.name || s.customer?.email || s.customer?.phone || s.customerId;
      const product = s.product?.name || s.plan?.name;
      return `Suscripción · ${customer}${product ? ` · ${product}` : ""}`;
    }
    if (ctx.customerId && customerById.has(String(ctx.customerId))) {
      const c = customerById.get(String(ctx.customerId)) as any;
      return `Cliente · ${c.name || c.email || c.phone || c.id}`;
    }
    if (ctx.productId && productById.has(String(ctx.productId))) {
      const p = productById.get(String(ctx.productId)) as any;
      return `Producto · ${p.name || p.id}`;
    }
    if (ctx.planId && planById.has(String(ctx.planId))) {
      const p = planById.get(String(ctx.planId)) as any;
      return `Plan · ${p.name || p.id}`;
    }
    if (ctx.webhookEventId && webhookById.has(String(ctx.webhookEventId))) {
      const w = webhookById.get(String(ctx.webhookEventId)) as any;
      return `Webhook · ${w.eventName || w.id}`;
    }
    return null;
  }

  const enriched = items.map((item: any) => ({
    ...item,
    actor: inferActor(item),
    entity: formatEntity(item)
  }));

  return { items: enriched, total };
}

export async function listRetryJobs(args: { take?: number; skip?: number; from?: string; to?: string; withCount?: boolean }) {
  const withCount = Boolean(args.withCount);
  const take = Math.min(200, Math.max(1, Number(args.take ?? 20)));
  const skip = Math.max(0, Number(args.skip ?? 0));
  const fromRaw = String(args.from ?? "").trim();
  const toRaw = String(args.to ?? "").trim();
  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw, { end: true });
  const where = {
    updatedAt: {
      gte: fromDate,
      ...(toDate ? { lt: toDate } : {})
    }
  } as Prisma.RetryJobWhereInput;

  const [items, total] = await Promise.all([
    prisma.retryJob.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take,
      skip,
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        runAt: true,
        lockedAt: true,
        lockedBy: true,
        updatedAt: true,
        payload: true,
        lastError: true
      }
    }),
    withCount ? prisma.retryJob.count({ where }) : Promise.resolve(null)
  ]);

  const subscriptionIds = new Set<string>();
  const paymentIds = new Set<string>();
  const customerIds = new Set<string>();
  const webhookIds = new Set<string>();
  const messageIds = new Set<string>();

  for (const item of items) {
    const payload: any = item.payload || {};
    if (payload.subscriptionId) subscriptionIds.add(String(payload.subscriptionId));
    if (payload.paymentId) paymentIds.add(String(payload.paymentId));
    if (payload.customerId) customerIds.add(String(payload.customerId));
    if (payload.webhookEventId) webhookIds.add(String(payload.webhookEventId));
    if (payload.messageId) messageIds.add(String(payload.messageId));
  }

  const [subscriptions, payments, customers, webhooks, messages] = await Promise.all([
    subscriptionIds.size
      ? prisma.subscription.findMany({
          where: { id: { in: Array.from(subscriptionIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } },
            plan: { select: { name: true } }
          }
        })
      : Promise.resolve([]),
    paymentIds.size
      ? prisma.payment.findMany({
          where: { id: { in: Array.from(paymentIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } },
            subscription: { select: { plan: { select: { name: true } } } }
          }
        })
      : Promise.resolve([]),
    customerIds.size
      ? prisma.customer.findMany({
          where: { id: { in: Array.from(customerIds) } },
          select: { id: true, name: true, email: true, phone: true }
        })
      : Promise.resolve([]),
    webhookIds.size
      ? prisma.webhookEvent.findMany({
          where: { id: { in: Array.from(webhookIds) } },
          select: { id: true, eventName: true, processStatus: true, errorMessage: true }
        })
      : Promise.resolve([]),
    messageIds.size
      ? prisma.chatwootMessage.findMany({
          where: { id: { in: Array.from(messageIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } }
          }
        })
      : Promise.resolve([])
  ]);

  const subById = new Map(subscriptions.map((s) => [String(s.id), s]));
  const paymentById = new Map(payments.map((p) => [String(p.id), p]));
  const customerById = new Map(customers.map((c) => [String(c.id), c]));
  const webhookById = new Map(webhooks.map((w) => [String(w.id), w]));
  const messageById = new Map(messages.map((m) => [String(m.id), m]));

  function formatTarget(payload: any) {
    const subscriptionId = payload?.subscriptionId ? String(payload.subscriptionId) : "";
    const paymentId = payload?.paymentId ? String(payload.paymentId) : "";
    const customerId = payload?.customerId ? String(payload.customerId) : "";
    const webhookEventId = payload?.webhookEventId ? String(payload.webhookEventId) : "";
    const messageId = payload?.messageId ? String(payload.messageId) : "";

    if (paymentId && paymentById.has(paymentId)) {
      const p: any = paymentById.get(paymentId);
      const customer = p.customer?.name || p.customer?.email || p.customer?.phone || p.customerId;
      const plan = p.subscription?.plan?.name ? ` · ${p.subscription.plan.name}` : "";
      return { label: `Pago · ${customer}${plan}`, id: paymentId };
    }
    if (subscriptionId && subById.has(subscriptionId)) {
      const s: any = subById.get(subscriptionId);
      const customer = s.customer?.name || s.customer?.email || s.customer?.phone || s.customerId;
      const plan = s.plan?.name ? ` · ${s.plan.name}` : "";
      return { label: `Suscripción · ${customer}${plan}`, id: subscriptionId };
    }
    if (messageId && messageById.has(messageId)) {
      const m: any = messageById.get(messageId);
      const customer = m.customer?.name || m.customer?.email || m.customer?.phone || m.customerId;
      return { label: `Mensaje · ${customer}`, id: messageId };
    }
    if (webhookEventId && webhookById.has(webhookEventId)) {
      const w: any = webhookById.get(webhookEventId);
      return { label: `Webhook · ${w.eventName || w.id}`, id: webhookEventId };
    }
    if (customerId && customerById.has(customerId)) {
      const c: any = customerById.get(customerId);
      return { label: `Cliente · ${c.name || c.email || c.phone || c.id}`, id: customerId };
    }
    if (subscriptionId) return { label: `Suscripción · ${subscriptionId}`, id: subscriptionId };
    if (paymentId) return { label: `Pago · ${paymentId}`, id: paymentId };
    if (customerId) return { label: `Cliente · ${customerId}`, id: customerId };
    if (messageId) return { label: `Mensaje · ${messageId}`, id: messageId };
    if (webhookEventId) return { label: `Webhook · ${webhookEventId}`, id: webhookEventId };
    return { label: "—", id: null };
  }

  const enriched = items.map((item) => {
    const payload: any = item.payload || {};
    const target = formatTarget(payload);
    const webhookEventId = payload?.webhookEventId ? String(payload.webhookEventId) : null;
    const webhook = webhookEventId && webhookById.has(webhookEventId) ? webhookById.get(webhookEventId) : null;
    return {
      ...item,
      targetLabel: target.label,
      targetId: target.id,
      webhookProcessStatus: webhook ? (webhook as any).processStatus : null,
      webhookErrorMessage: webhook ? (webhook as any).errorMessage : null
    };
  });

  return { items: enriched, total };
}

export async function listChatwootMessages(args: {
  take?: number;
  skip?: number;
  from?: string;
  to?: string;
  withCount?: boolean;
  status?: string;
  type?: string;
  q?: string;
}) {
  const withCount = Boolean(args.withCount);
  const take = Math.min(200, Math.max(1, Number(args.take ?? 20)));
  const skip = Math.max(0, Number(args.skip ?? 0));
  const q = String(args.q ?? "").trim();
  const statusRaw = String(args.status ?? "").trim().toUpperCase();
  const typeRaw = String(args.type ?? "").trim().toUpperCase();
  const status = ["PENDING", "SENT", "FAILED"].includes(statusRaw) ? statusRaw : "";
  const type = ["PAYMENT_LINK", "PAYMENT_CONFIRMED", "EXPIRY_WARNING", "PAYMENT_FAILED"].includes(typeRaw) ? typeRaw : "";
  const exactType =
    [
      "PAYMENT_LINK_LINK",
      "PAYMENT_LINK_SUBSCRIPTION",
      "TOKENIZATION_LINK",
      "CATALOG_LINK_PLAN",
      "CATALOG_LINK_SUBSCRIPTION",
      "PAYMENT_APPROVED",
      "PAYMENT_DECLINED_LINK",
      "PAYMENT_DECLINED_SUBSCRIPTION"
    ].includes(typeRaw)
      ? typeRaw
      : "";
  const fromRaw = String(args.from ?? "").trim();
  const toRaw = String(args.to ?? "").trim();
  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw, { end: true });
  const where: Prisma.ChatwootMessageWhereInput = {
    createdAt: {
      gte: fromDate,
      ...(toDate ? { lt: toDate } : {})
    }
  };
  if (status) where.status = status as any;
  if (type) where.type = type as any;
  if (exactType === "PAYMENT_LINK_LINK") {
    where.type = "PAYMENT_LINK" as any;
    where.AND = [
      { providerResp: { path: ["meta", "trigger"], equals: "PAYMENT_LINK_CREATED" } as any },
      { providerResp: { path: ["meta", "paymentType"], equals: "LINK" } as any }
    ];
  } else if (exactType === "PAYMENT_LINK_SUBSCRIPTION") {
    where.type = "PAYMENT_LINK" as any;
    where.AND = [
      { providerResp: { path: ["meta", "trigger"], equals: "PAYMENT_LINK_CREATED" } as any },
      { providerResp: { path: ["meta", "paymentType"], equals: "SUBSCRIPTION" } as any }
    ];
  } else if (exactType === "TOKENIZATION_LINK") {
    where.type = "PAYMENT_LINK" as any;
    where.AND = [
      { providerResp: { path: ["meta", "trigger"], equals: "TOKENIZATION_LINK_CREATED" } as any }
    ];
  } else if (exactType === "CATALOG_LINK_PLAN") {
    where.type = "PAYMENT_LINK" as any;
    where.AND = [
      { providerResp: { path: ["meta", "trigger"], equals: "CATALOG_LINK_CREATED" } as any },
      { providerResp: { path: ["meta", "paymentType"], equals: "PLAN" } as any }
    ];
  } else if (exactType === "CATALOG_LINK_SUBSCRIPTION") {
    where.type = "PAYMENT_LINK" as any;
    where.AND = [
      { providerResp: { path: ["meta", "trigger"], equals: "CATALOG_LINK_CREATED" } as any },
      { providerResp: { path: ["meta", "paymentType"], equals: "SUBSCRIPTION" } as any }
    ];
  } else if (exactType === "PAYMENT_APPROVED") {
    where.type = "PAYMENT_CONFIRMED" as any;
    where.AND = [
      { providerResp: { path: ["meta", "trigger"], equals: "PAYMENT_APPROVED" } as any }
    ];
  } else if (exactType === "PAYMENT_DECLINED_LINK") {
    where.type = "PAYMENT_FAILED" as any;
    where.AND = [
      { providerResp: { path: ["meta", "trigger"], equals: "PAYMENT_DECLINED" } as any },
      { providerResp: { path: ["meta", "paymentType"], equals: "LINK" } as any }
    ];
  } else if (exactType === "PAYMENT_DECLINED_SUBSCRIPTION") {
    where.type = "PAYMENT_FAILED" as any;
    where.AND = [
      { providerResp: { path: ["meta", "trigger"], equals: "PAYMENT_DECLINED" } as any },
      { providerResp: { path: ["meta", "paymentType"], equals: "SUBSCRIPTION" } as any }
    ];
  }
  if (q) {
    const insensitive = Prisma.QueryMode.insensitive;
    const qOr: Prisma.ChatwootMessageWhereInput[] = [
      { content: { contains: q, mode: insensitive } },
      { errorMessage: { contains: q, mode: insensitive } },
      { to: { contains: q, mode: insensitive } },
      { actor: { contains: q, mode: insensitive } },
      {
        customer: {
          is: {
            OR: [
              { name: { contains: q, mode: insensitive } },
              { email: { contains: q, mode: insensitive } },
              { phone: { contains: q, mode: insensitive } }
            ]
          }
        }
      }
    ];
    const qWhere: Prisma.ChatwootMessageWhereInput = { OR: qOr };
    if (Array.isArray(where.AND) && where.AND.length) {
      where.AND = [...where.AND, qWhere];
    } else {
      where.OR = qOr;
    }
  }
  const [items, total] = await Promise.all([
    prisma.chatwootMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } }
      }
    }),
    withCount ? prisma.chatwootMessage.count({ where }) : Promise.resolve(null)
  ]);
  return { items, total };
}

export async function listWebhookEvents(args: {
  take?: number;
  skip?: number;
  q?: string;
  processStatus?: string;
  from?: string;
  to?: string;
  tenantId?: string;
  withCount?: boolean;
}) {
  const withCount = Boolean(args.withCount);
  const take = Math.min(200, Math.max(1, Number(args.take ?? 20)));
  const skip = Math.max(0, Number(args.skip ?? 0));
  const q = String(args.q ?? "").trim();
  const processStatus = String(args.processStatus ?? "").trim();
  const fromRaw = String(args.from ?? "").trim();
  const toRaw = String(args.to ?? "").trim();
  const tenantId = String(args.tenantId ?? "").trim();

  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw, { end: true });

  const baseWhere = {
    ...(processStatus ? { processStatus: processStatus as any } : {}),
    ...(tenantId ? { tenantId } : {}),
    receivedAt: {
      gte: fromDate,
      ...(toDate ? { lt: toDate } : {})
    }
  } as any;

  const [items, total] = await Promise.all([
    prisma.webhookEvent.findMany({
      orderBy: { receivedAt: "desc" },
      take,
      skip,
      where: baseWhere
    }),
    withCount && !q ? prisma.webhookEvent.count({ where: baseWhere }) : Promise.resolve(null)
  ]);

  const extractTx = (payload: unknown): Record<string, any> => {
    if (!payload || typeof payload !== "object") return {};
    const root = payload as Record<string, any>;
    const data = root.data;
    if (data && typeof data === "object") {
      const tx = (data as any).transaction;
      if (tx && typeof tx === "object") return tx as Record<string, any>;
      if ((data as any).id || (data as any).reference) return data as Record<string, any>;
      const nested = (data as any).data;
      if (nested && typeof nested === "object" && (((nested as any).id && typeof (nested as any).id !== "object") || (nested as any).reference)) {
        return nested as Record<string, any>;
      }
    }
    const direct = (root as any).transaction;
    if (direct && typeof direct === "object") return direct as Record<string, any>;
    return {};
  };

  const paymentLinkIds = new Set<string>();
  const references = new Set<string>();
  const transactionIds = new Set<string>();
  for (const item of items) {
    const tx: any = extractTx(item.payload);
    const linkId = tx?.payment_link_id ?? tx?.paymentLinkId ?? tx?.payment_link?.id ?? tx?.paymentLink?.id;
    if (linkId) paymentLinkIds.add(String(linkId));
    if (tx?.reference) references.add(String(tx.reference));
    if (tx?.id) transactionIds.add(String(tx.id));
  }

  const paymentFilters: any[] = [];
  if (paymentLinkIds.size) paymentFilters.push({ wompiPaymentLinkId: { in: Array.from(paymentLinkIds) } });
  if (references.size) paymentFilters.push({ reference: { in: Array.from(references) } });
  if (transactionIds.size) paymentFilters.push({ wompiTransactionId: { in: Array.from(transactionIds) } });

  const payments = paymentFilters.length
    ? await prisma.payment.findMany({
        where: { OR: paymentFilters },
        select: {
          id: true,
          reference: true,
          wompiPaymentLinkId: true,
          wompiTransactionId: true,
          amountInCents: true,
          currency: true,
          status: true,
          subscriptionId: true,
          subscription: {
            select: {
              productId: true,
              product: { select: { name: true } },
              plan: { select: { name: true, metadata: true } }
            }
          },
          customer: { select: { id: true, name: true, email: true, phone: true } }
        }
      })
    : [];

  const paymentByLink = new Map<string, (typeof payments)[number]>();
  const paymentByRef = new Map<string, (typeof payments)[number]>();
  const paymentByTx = new Map<string, (typeof payments)[number]>();
  for (const p of payments) {
    if (p.wompiPaymentLinkId) paymentByLink.set(String(p.wompiPaymentLinkId), p);
    if (p.reference) paymentByRef.set(String(p.reference), p);
    if (p.wompiTransactionId) paymentByTx.set(String(p.wompiTransactionId), p);
  }

  function resolvePayment(item: any) {
    const tx = extractTx(item.payload);
    const linkId = tx?.payment_link_id ? String(tx.payment_link_id) : tx?.paymentLinkId ? String(tx.paymentLinkId) : "";
    const reference = String(tx?.reference || "");
    const txId = tx?.id ? String(tx.id) : "";
    if (linkId && paymentByLink.has(linkId)) return paymentByLink.get(linkId) || null;
    if (txId && paymentByTx.has(txId)) return paymentByTx.get(txId) || null;
    if (reference && paymentByRef.has(reference)) return paymentByRef.get(reference) || null;
    return null;
  }

  function paymentTypeFor(item: any) {
    const tx = extractTx(item.payload);
    const linkId = tx?.payment_link_id ? String(tx.payment_link_id) : tx?.paymentLinkId ? String(tx.paymentLinkId) : "";
    const reference = String(tx?.reference || "");
    const payment = resolvePayment(item);

    if (payment?.subscriptionId) {
      const mode = String((payment.subscription as any)?.plan?.metadata?.collectionMode || "");
      if (mode === "AUTO_LINK") return "Pago del producto";
      if (mode === "AUTO_DEBIT") return "Pago suscripción";
      return "Pago suscripción";
    }

    if (reference.startsWith("ORDER_")) return "Pago por link de pago";
    if (reference.startsWith("SUB_")) return "Pago suscripción";
    if (linkId) return "Pago por link de pago";
    return "Pago por link de pago";
  }

  function productNameFor(item: any) {
    const payment = resolvePayment(item);
    return payment?.subscription?.product?.name || payment?.subscription?.plan?.name || null;
  }

  const normalized = items.map((item: any) => {
    const tx = extractTx(item.payload);
    const payloadData = (item.payload && typeof item.payload === "object" ? (item.payload as any).data : null) as any;
    const payment = resolvePayment(item);
    return {
      id: item.id,
      provider: item.provider,
      eventName: item.eventName,
      processStatus: item.processStatus,
      checksum: item.checksum,
      receivedAt: item.receivedAt,
      updatedAt: item.updatedAt,
      providerTs: item.providerTs,
      tenantId: item.tenantId,
      txId: tx?.id || payloadData?.id || null,
      txStatus: tx?.status || payloadData?.status || null,
      txReference: tx?.reference || payloadData?.reference || null,
      paymentLinkId:
        tx?.payment_link_id ||
        tx?.paymentLinkId ||
        tx?.payment_link?.id ||
        tx?.paymentLink?.id ||
        payloadData?.payment_link_id ||
        null,
      paymentAmountInCents: payment?.amountInCents ?? null,
      paymentCurrency: payment?.currency ?? null,
      paymentStatus: payment?.status ?? null,
      paymentType: paymentTypeFor(item),
      productId: payment?.subscription?.productId ?? (payment?.subscription?.plan as any)?.catalogProductId ?? payment?.subscription?.plan?.metadata?.catalog?.itemId ?? null,
      productName: productNameFor(item),
      planName: payment?.subscription?.plan?.name ?? null,
      customer: payment?.customer ?? null,
      payload: item.payload
    };
  });

  const filtered = q
    ? normalized.filter((item) => {
        const haystack = [
          item.eventName,
          item.txId,
          item.txReference,
          item.paymentLinkId,
          item.paymentType,
          item.productName,
          item.planName,
          item.customer?.name,
          item.customer?.email,
          item.customer?.phone
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q.toLowerCase());
      })
    : normalized;

  return { ok: true, items: filtered, ...(withCount ? { total: total ?? filtered.length } : {}) };
}

export async function getJobsHealth() {
  const key = String(process.env.JOBS_HEARTBEAT_KEY || "wompi-subs-jobs").trim() || "wompi-subs-jobs";
  const ttlSecondsRaw = Number(process.env.JOBS_HEALTH_TTL_SECONDS || 180);
  const ttlSeconds = Number.isFinite(ttlSecondsRaw) ? Math.max(30, Math.trunc(ttlSecondsRaw)) : 180;
  const [heartbeat, latestWorkerHeartbeat, pendingCount, runningCount, failedCount, nextJob] = await Promise.all([
    prisma.serviceHeartbeat.findUnique({ where: { key } }),
    prisma.serviceHeartbeat.findFirst({
      where: { key: { startsWith: "jobs:" } },
      orderBy: { lastSeenAt: "desc" }
    }),
    prisma.retryJob.count({ where: { status: RetryJobStatus.PENDING } }),
    prisma.retryJob.count({ where: { status: RetryJobStatus.RUNNING } }),
    prisma.retryJob.count({ where: { status: RetryJobStatus.FAILED } }),
    prisma.retryJob.findFirst({
      where: { status: RetryJobStatus.PENDING },
      orderBy: { runAt: "asc" },
      select: { type: true, runAt: true }
    })
  ]);
  const effectiveHeartbeat = heartbeat || latestWorkerHeartbeat || null;
  const now = new Date();
  const lastSeenAt = effectiveHeartbeat?.lastSeenAt || null;
  const ageMs = lastSeenAt ? now.getTime() - lastSeenAt.getTime() : null;
  const healthy = lastSeenAt ? ageMs != null && ageMs <= ttlSeconds * 1000 : false;
  const stalled = !healthy && (pendingCount > 0 || runningCount > 0 || failedCount > 0);
  const status = healthy ? "healthy" : stalled ? "stalled" : "idle";
  const nextJobAt = nextJob?.runAt ? nextJob.runAt.toISOString() : null;
  return {
    ok: !!lastSeenAt,
    healthy,
    stalled,
    status,
    key,
    lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
    ageMs,
    ttlSeconds,
    pending: pendingCount,
    running: runningCount,
    failed: failedCount,
    nextJobType: nextJob?.type || null,
    nextJobAt,
    workerType:
      typeof effectiveHeartbeat?.meta === "object" && effectiveHeartbeat?.meta && "type" in (effectiveHeartbeat.meta as any)
        ? String((effectiveHeartbeat.meta as any).type || "") || null
        : null,
    heartbeatSource: heartbeat ? "stable" : latestWorkerHeartbeat ? "dynamic" : null,
    heartbeatKey: effectiveHeartbeat?.key || null
  };
}

export async function getPaymentsHealth() {
  const [eventsSecret, defaultTenantId] = await Promise.all([
    getWompiEventsSecret().catch(() => undefined),
    getDefaultTenantId().catch(() => null)
  ]);

  const [pendingCount, failedCount, oldestPending, latestReceived, latestProcessed] = await Promise.all([
    prisma.webhookEvent.count({
      where: { provider: WebhookProvider.WOMPI, processStatus: WebhookProcessStatus.RECEIVED }
    }),
    prisma.webhookEvent.count({
      where: { provider: WebhookProvider.WOMPI, processStatus: WebhookProcessStatus.FAILED }
    }),
    prisma.webhookEvent.findFirst({
      where: { provider: WebhookProvider.WOMPI, processStatus: WebhookProcessStatus.RECEIVED },
      orderBy: { receivedAt: "asc" },
      select: { receivedAt: true, eventName: true, id: true }
    }),
    prisma.webhookEvent.findFirst({
      where: { provider: WebhookProvider.WOMPI },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true, eventName: true, processStatus: true, id: true }
    }),
    prisma.webhookEvent.findFirst({
      where: { provider: WebhookProvider.WOMPI, processStatus: WebhookProcessStatus.PROCESSED },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true, eventName: true, id: true }
    })
  ]);

  const oldestPendingAt = oldestPending?.receivedAt ? oldestPending.receivedAt.toISOString() : null;
  const latestWebhookAt = latestReceived?.receivedAt ? latestReceived.receivedAt.toISOString() : null;
  const latestWebhookEventName = latestReceived?.eventName || null;
  const latestWebhookStatus = latestReceived?.processStatus || null;
  const latestProcessedAt = latestProcessed?.receivedAt ? latestProcessed.receivedAt.toISOString() : null;
  const latestProcessedEventName = latestProcessed?.eventName || null;

  return {
    wompiEventsSecretConfigured: Boolean(eventsSecret),
    defaultTenantConfigured: Boolean(defaultTenantId),
    pendingWebhookEvents: pendingCount,
    failedWebhookEvents: failedCount,
    oldestPendingAt,
    latestWebhookAt,
    latestWebhookEventName,
    latestWebhookStatus,
    latestProcessedAt,
    latestProcessedEventName
  };
}
