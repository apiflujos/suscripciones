import { LogLevel, PaymentStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { createAiChatCompletion } from "../../services/aiClient";
import { getReportCache, setReportCache } from "../../services/reportCache";
import { getDefaultTenantId } from "../../services/tenantContext";
import { systemLog } from "../../services/systemLog";
import { getMetricsOverview } from "../../services/metrics";
import { getOperationsReport, getChatwootReport } from "../../services/reports";
import { buildSubscriptionBillingStateIndex } from "../../services/billingCycles";

type AiAssistPayload = {
  requestId?: string;
  question?: string;
  from?: string;
  to?: string;
  tenantId?: string;
  customerId?: string;
  productId?: string;
  scope?: string;
};

type ChartItem = { label: string; value: number; tone?: "success" | "warning" | "danger" | "info" };

function parseDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function clampString(value?: string | null, max = 4000) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.length <= max) return v;
  return `${v.slice(0, max - 1)}…`;
}

function formatCurrency(cents?: number | null, currency?: string | null) {
  if (typeof cents !== "number") return null;
  const value = Math.max(0, Math.round(cents / 100));
  return `${new Intl.NumberFormat("es-CO").format(value)} ${currency || "COP"}`;
}

function inferGranularity(from: Date, to: Date) {
  const range = Math.max(1, to.getTime() - from.getTime());
  const days = range / (24 * 60 * 60 * 1000);
  if (days > 120) return "month" as const;
  if (days > 35) return "week" as const;
  return "day" as const;
}

export async function aiAssist(payload: AiAssistPayload) {
  const requestId = String(payload?.requestId || "").trim() || `ai_${Date.now()}`;
  const question = String(payload?.question || "").trim();
  if (!question) {
    throw new Error("ai_question_missing");
  }

  const to = parseDate(payload?.to) || new Date();
  const from = parseDate(payload?.from) || new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const tenantId = String(payload?.tenantId || "").trim() || null;
  const customerId = String(payload?.customerId || "").trim() || null;
  const productId = String(payload?.productId || "").trim() || null;
  const scopeRaw = String(payload?.scope || "").trim();
  const scope =
    scopeRaw === "metrics" || scopeRaw === "customer" || scopeRaw === "product" || scopeRaw === "logs" ? scopeRaw : "logs";
  const cacheTenantId = tenantId || (await getDefaultTenantId());

  const cacheKey = cacheTenantId
    ? {
        reportKey: "ai.assist",
        tenantId: cacheTenantId,
        from,
        to,
        granularity: null,
        filters: {
          question,
          customerId: customerId || null,
          tenantId: tenantId || null,
          productId: productId || null,
          scope: scope || null
        },
        version: "v1"
      }
    : null;

  if (cacheKey) {
    const cached = await getReportCache(cacheKey);
    if (cached.hit) {
      const payload = (cached.payload && typeof cached.payload === "object" ? cached.payload : {}) as any;
      await systemLog(LogLevel.INFO, "ai.chat.cached", "Respuesta IA (cache)", {
        requestId,
        question,
        tenantId,
        customerId,
        productId,
        scope,
        cached: true,
        stale: cached.stale,
        provider: payload.provider,
        model: payload.model,
        answer: payload.answer,
        chart: payload.chart,
        context: payload.context
      }).catch((err: any) => {
        logger.warn({ err, requestId, tenantId, scope }, "aiAssist: fallo escribiendo systemLog de cache");
      });
      if (!cached.stale) return;
      return;
    }
  }

  const systemWhere: any = { createdAt: { gte: from, lt: to } };
  if (customerId) {
    systemWhere.context = { path: ["customerId"], equals: customerId };
  } else if (tenantId) {
    systemWhere.context = { path: ["tenantId"], equals: tenantId };
  }

  const [systemLogs, webhooks, jobs, payments] = await Promise.all([
    prisma.systemLog.findMany({
      where: systemWhere,
      orderBy: { createdAt: "desc" },
      take: 120
    }),
    scope === "customer"
      ? Promise.resolve([])
      : prisma.webhookEvent.findMany({
          where: {
            receivedAt: { gte: from, lt: to },
            ...(tenantId ? { tenantId } : {})
          },
          orderBy: { receivedAt: "desc" },
          take: 120
        }),
    prisma.retryJob.findMany({
      where: { updatedAt: { gte: from, lt: to } },
      orderBy: { updatedAt: "desc" },
      take: 120
    }),
    prisma.payment.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        ...(tenantId ? { tenantId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(productId
          ? {
              subscription: {
                OR: [
                  { productId },
                  { plan: { catalogProductId: productId } }
                ]
              }
            }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: 80,
      include: { customer: true, subscription: { include: { plan: true, product: true } } }
    })
  ]);

  const systemCounts = systemLogs.reduce(
    (acc, l) => {
      const level = String(l.level || "").toUpperCase();
      if (level === "ERROR") acc.error += 1;
      else if (level === "WARN") acc.warn += 1;
      else acc.info += 1;
      return acc;
    },
    { error: 0, warn: 0, info: 0 }
  );

  const webhookCounts = webhooks.reduce(
    (acc, w) => {
      const status = String(w.processStatus || "").toUpperCase();
      if (status === "PROCESSED") acc.processed += 1;
      else if (status === "FAILED") acc.failed += 1;
      else acc.received += 1;
      return acc;
    },
    { processed: 0, failed: 0, received: 0 }
  );

  const jobCounts = jobs.reduce(
    (acc, j) => {
      const status = String(j.status || "").toUpperCase();
      if (status === "FAILED") acc.failed += 1;
      else if (status === "PENDING") acc.pending += 1;
      else if (status === "RUNNING") acc.running += 1;
      else acc.succeeded += 1;
      return acc;
    },
    { failed: 0, pending: 0, running: 0, succeeded: 0 }
  );

  const paymentCounts = payments.reduce(
    (acc, p) => {
      const status = String(p.status || "").toUpperCase() as PaymentStatus;
      if (status === "APPROVED") acc.approved += 1;
      else if (status === "PENDING") acc.pending += 1;
      else acc.failed += 1;
      return acc;
    },
    { approved: 0, pending: 0, failed: 0 }
  );

  const questionLower = question.toLowerCase();
  let chartTitle = "Resumen operativo";
  let chartItems: ChartItem[] = [
    { label: "Webhooks OK", value: webhookCounts.processed, tone: "success" },
    { label: "Webhooks fallidos", value: webhookCounts.failed, tone: "danger" },
    { label: "Jobs fallidos", value: jobCounts.failed, tone: "danger" },
    { label: "Alertas", value: systemCounts.error, tone: "warning" }
  ];

  if (scope === "metrics") {
    chartTitle = "Pagos y conversión";
    chartItems = [
      { label: "Pagos OK", value: paymentCounts.approved, tone: "success" },
      { label: "Pagos fallidos", value: paymentCounts.failed, tone: "danger" },
      { label: "Links pagados", value: webhookCounts.processed, tone: "info" }
    ];
  } else if (questionLower.includes("pago") || questionLower.includes("payment")) {
    chartTitle = "Pagos en el periodo";
    chartItems = [
      { label: "Aprobados", value: paymentCounts.approved, tone: "success" },
      { label: "Pendientes", value: paymentCounts.pending, tone: "warning" },
      { label: "Fallidos", value: paymentCounts.failed, tone: "danger" }
    ];
  } else if (questionLower.includes("webhook")) {
    chartTitle = "Webhooks en el periodo";
    chartItems = [
      { label: "Procesados", value: webhookCounts.processed, tone: "success" },
      { label: "Fallidos", value: webhookCounts.failed, tone: "danger" },
      { label: "Recibidos", value: webhookCounts.received, tone: "info" }
    ];
  } else if (questionLower.includes("job")) {
    chartTitle = "Jobs en el periodo";
    chartItems = [
      { label: "En cola", value: jobCounts.pending, tone: "warning" },
      { label: "Corriendo", value: jobCounts.running, tone: "info" },
      { label: "Fallidos", value: jobCounts.failed, tone: "danger" },
      { label: "Completados", value: jobCounts.succeeded, tone: "success" }
    ];
  }

  const chart = {
    type: "bars",
    title: chartTitle,
    items: chartItems.filter((i) => i.value > 0)
  };

  const sampleSystem = systemLogs.slice(0, 12).map((l) => ({
    ts: l.createdAt,
    level: l.level,
    source: l.source,
    message: clampString(l.message, 180)
  }));
  const sampleWebhooks = webhooks.slice(0, 10).map((w) => {
    const payload: any = w.payload;
    const tx = payload?.data?.transaction || {};
    return {
      ts: w.receivedAt,
      status: w.processStatus,
      paymentStatus: tx?.status,
      reference: clampString(tx?.reference || "", 80)
    };
  });
  const sampleJobs = jobs.slice(0, 10).map((j) => ({
    ts: j.updatedAt,
    type: j.type,
    status: j.status,
    error: clampString(j.lastError || "", 140),
    attempts: `${j.attempts}/${j.maxAttempts}`
  }));
  const samplePayments = payments.slice(0, 8).map((p) => ({
    ts: p.createdAt,
    status: p.status,
    amount: formatCurrency(p.amountInCents, p.currency),
    customer: p.customer?.name || p.customer?.email || p.customer?.phone || p.customerId,
    product: p.subscription?.product?.name || p.subscription?.plan?.name || null,
    reference: clampString(p.reference || "", 80)
  }));

  const context = {
    window: { from: from.toISOString(), to: to.toISOString() },
    scope,
    tenantId,
    customerId,
    productId,
    counts: {
      system: systemCounts,
      webhooks: webhookCounts,
      jobs: jobCounts,
      payments: paymentCounts
    },
    samples: {
      system: sampleSystem,
      webhooks: sampleWebhooks,
      jobs: sampleJobs,
      payments: samplePayments
    }
  };

  if (scope === "metrics") {
    const granularity = inferGranularity(from, to);
    const [metrics, ops, chat] = await Promise.all([
      getMetricsOverview({ from, to, granularity, tenantId }),
      getOperationsReport({ from, to, granularity, tenantId }),
      getChatwootReport({ from, to, granularity, tenantId })
    ]);
    (context as any).metrics = {
      totals: metrics.totals,
      breakdown: metrics.breakdown,
      series: metrics.series.slice(-12)
    };
    (context as any).operations = {
      totals: ops.totals,
      series: ops.series.slice(-12)
    };
    (context as any).chatwoot = {
      totals: chat.totals,
      series: chat.series.slice(-12)
    };
  }

  if (scope === "customer" && customerId) {
    const [customer, subs] = await Promise.all([
      prisma.customer.findUnique({ where: { id: customerId } }),
      prisma.subscription.findMany({
        where: { customerId },
        include: { plan: true, product: true },
        orderBy: { createdAt: "desc" },
        take: 12
      })
    ]);
    const billingStateBySubscription = await buildSubscriptionBillingStateIndex({
      subscriptions: subs.map((s) => ({
        id: s.id,
        startAt: s.startAt,
        cycleStartDay: s.cycleStartDay,
        paymentDay: s.paymentDay,
        paymentTiming: (s.paymentTiming as any) === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO",
        graceDays: s.graceDays,
        plan: {
          intervalUnit: s.plan.intervalUnit,
          intervalCount: s.plan.intervalCount
        }
      })),
      ensureCycles: false
    });
    (context as any).customer = customer || null;
    (context as any).subscriptions = subs.map((s) => {
      const billingState = billingStateBySubscription.get(String(s.id)) || null;
      const activeCycle = billingState?.activeCycle || null;
      const collectionCycle = billingState?.collectionCycle || activeCycle;
      return {
        id: s.id,
        status: s.status,
        productId: s.productId || String((s.plan as any)?.catalogProductId || (s.plan?.metadata as any)?.catalog?.itemId || "").trim() || null,
        product: s.product?.name || s.plan?.name || null,
        plan: s.plan?.name || null,
        activeCycleNumber: activeCycle?.cycleNumber ?? null,
        activeCycleEndAt: activeCycle?.periodEndAt ?? null,
        nextBillingDate: collectionCycle?.dueAt ?? activeCycle?.periodEndAt ?? null
      };
    });
  }

  if (scope === "product" && productId) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: productId } });
    (context as any).product = plan
      ? { id: plan.id, name: plan.name, planType: plan.planType, priceInCents: plan.priceInCents }
      : null;
  }

  const messages = [
    {
      role: "system" as const,
      content:
        "Eres un analista operativo para Apiflujos. Responde en español con un resumen claro, pasos accionables y menciona datos concretos del contexto. Si no hay evidencia suficiente, dilo."
    },
    {
      role: "user" as const,
      content: `Pregunta: ${question}\n\nContexto (resumen):\n${JSON.stringify(context)}`
    }
  ];

  try {
    const result = await createAiChatCompletion(messages, { requestId, question });
    const answer = clampString(result.content, 3800);
    if (cacheKey) {
      await setReportCache(
        cacheKey,
        { answer, provider: result.provider, model: result.model, chart, context },
        6 * 60 * 60,
        24 * 60 * 60
      );
    }
    await systemLog(LogLevel.INFO, "ai.chat", "Respuesta IA generada", {
      requestId,
      question,
      tenantId,
      customerId,
      productId,
      scope,
      answer,
      provider: result.provider,
      model: result.model,
      chart,
      context
    });
  } catch (err: any) {
    const msg = String(err?.message || err || "ai_failed");
    await systemLog(LogLevel.ERROR, "ai.chat", "Error generando respuesta IA", {
      requestId,
      question,
      tenantId,
      customerId,
      productId,
      scope,
      error: msg,
      chart
    }).catch((logErr: any) => {
      logger.warn({ err: logErr, requestId, tenantId, scope }, "aiAssist: fallo escribiendo systemLog de error");
    });
    throw err;
  }
}
