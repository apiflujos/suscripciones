import { ChatwootMessageType, LogLevel, MessageStatus, PaymentStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { getNotificationsConfig, notificationTriggerSchema } from "../../services/notificationsConfig";
import { createPaymentLinkForSubscription } from "../../services/subscriptionBilling";
import { ensureChatwootContactForCustomer, syncChatwootAttributesForCustomer } from "../../services/chatwootSync";
import { systemLog } from "../../services/systemLog";

const payloadSchema = z.object({
  trigger: notificationTriggerSchema,
  ruleId: z.string().min(1),
  offsetSeconds: z.number().int().optional(),
  anchorAt: z.string().datetime().optional(),
  customerId: z.string().uuid().optional(),
  subscriptionId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  cycleNumber: z.number().int().positive().optional(),
  paymentStatus: z.enum(["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"]).optional()
});

function getPath(obj: any, path: string) {
  const parts = path.split(".").filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function renderTemplate(content: string, ctx: any) {
  return String(content || "").replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path) => {
    const v = getPath(ctx, String(path || ""));
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString();
    return String(v);
  });
}

function extractTemplatePaths(input: any): string[] {
  const out: string[] = [];
  const walk = (value: any) => {
    if (typeof value === "string") {
      const matches = value.match(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g) || [];
      for (const m of matches) {
        const path = m.replace(/[{}]/g, "").trim();
        if (path) out.push(path);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
      return;
    }
    if (value && typeof value === "object") {
      for (const v of Object.values(value)) walk(v);
    }
  };
  walk(input);
  return Array.from(new Set(out));
}

function renderAny(input: any, ctx: any): any {
  if (input == null) return input;
  if (typeof input === "string") return renderTemplate(input, ctx);
  if (Array.isArray(input)) return input.map((v) => renderAny(v, ctx));
  if (typeof input === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(input)) out[k] = renderAny(v, ctx);
    return out;
  }
  return input;
}

function dedupeKey(args: { trigger: string; ruleId: string; subscriptionId?: string; paymentId?: string; cycleNumber?: number; offsetSeconds?: number }) {
  const sub = args.subscriptionId || "-";
  const pay = args.paymentId || "-";
  const cycle = typeof args.cycleNumber === "number" ? String(args.cycleNumber) : "-";
  const off = typeof args.offsetSeconds === "number" ? String(args.offsetSeconds) : "0";
  return `notif:${args.trigger}:${args.ruleId}:${sub}:${cycle}:${pay}:${off}`;
}

function getPaymentType(args: { subscription?: any | null; payment?: any | null }) {
  const sub = args.subscription;
  if (sub?.plan) {
    const mode = String(sub.plan?.metadata?.collectionMode || "");
    if (mode === "AUTO_LINK") return "PLAN";
    if (mode === "AUTO_DEBIT") return "SUBSCRIPTION";
    return "SUBSCRIPTION";
  }
  if (args.payment?.subscriptionId) return "SUBSCRIPTION";
  return "LINK";
}

export async function subscriptionReminder(payload: any) {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return;

  const cfg = await getNotificationsConfig();
  const rule = cfg.rules.find((r) => r.id === parsed.data.ruleId);
  if (!rule || !rule.enabled) return;
  const template = cfg.templates.find((t) => t.id === rule.templateId);
  if (!template) return;

  await systemLog(LogLevel.INFO, "notifications.dispatch", "Procesando notificacion", {
    trigger: parsed.data.trigger,
    ruleId: parsed.data.ruleId,
    templateId: template.id,
    customerId: parsed.data.customerId || null,
    subscriptionId: parsed.data.subscriptionId || null,
    paymentId: parsed.data.paymentId || null
  }).catch(() => {});

  const subscriptionId = parsed.data.subscriptionId;
  const paymentId = parsed.data.paymentId;

  const [subscription, payment] = await Promise.all([
    subscriptionId
      ? prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { customer: true, plan: true } })
      : Promise.resolve(null),
    paymentId ? prisma.payment.findUnique({ where: { id: paymentId }, include: { customer: true, subscription: true } }) : Promise.resolve(null)
  ]);

  const customer =
    subscription?.customer ||
    payment?.customer ||
    (parsed.data.customerId ? await prisma.customer.findUnique({ where: { id: parsed.data.customerId } }) : null);

  if (!customer) return;

  if (subscription && rule.conditions?.skipIfSubscriptionStatusIn?.includes(subscription.status as any)) return;

  if (payment) {
    if (rule.conditions?.skipIfPaymentStatusIn?.includes(payment.status as any)) return;
    if (rule.conditions?.requirePaymentStatusIn && !rule.conditions.requirePaymentStatusIn.includes(payment.status as any)) return;
  }

  // Guard against old scheduled reminders after renewal: cycle/anchor must still match.
  if (subscription && parsed.data.trigger === "SUBSCRIPTION_DUE") {
    if (typeof parsed.data.cycleNumber === "number" && subscription.currentCycle !== parsed.data.cycleNumber) return;
    if (parsed.data.anchorAt) {
      const anchorIso = new Date(parsed.data.anchorAt).toISOString();
      if (subscription.currentPeriodEndAt.toISOString() !== anchorIso) return;
    }

    // Skip reminders if the upcoming cycle payment is already approved.
    const cycle = parsed.data.cycleNumber ?? subscription.currentCycle;
    const approved = await prisma.payment.findUnique({
      where: { subscriptionCycleKey: `${subscription.id}:${cycle}` },
      select: { status: true }
    });
    if (approved?.status === PaymentStatus.APPROVED) return;
  }

  if (template.channel === "META") {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "META template dispatch not implemented; skipping", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger
    }).catch(() => {});
    return;
  }

  if (!template.chatwootType) return;

  await ensureChatwootContactForCustomer(customer.id).catch(() => {});
  await syncChatwootAttributesForCustomer(customer.id).catch(() => {});

  let effectivePayment: any = payment;
  if (rule.ensurePaymentLink && subscription && parsed.data.trigger === "SUBSCRIPTION_DUE") {
    const cycle = parsed.data.cycleNumber ?? subscription.currentCycle;
    const subscriptionCycleKey = `${subscription.id}:${cycle}`;
    effectivePayment = await prisma.payment
      .findUnique({ where: { subscriptionCycleKey }, include: { customer: true, subscription: true } })
      .catch(() => null as any);
    if (!effectivePayment?.checkoutUrl) {
      try {
        const created = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
        effectivePayment = await prisma.payment.findUnique({ where: { id: created.paymentId }, include: { customer: true, subscription: true } });
      } catch (err: any) {
        await systemLog(LogLevel.WARN, "notifications.dispatch", "ensurePaymentLink failed; continuing without link", {
          subscriptionId: subscription.id,
          err: err?.message ? String(err.message) : "unknown error"
        }).catch(() => {});
      }
    }
  }

  const paymentType = getPaymentType({ subscription, payment: effectivePayment || payment });

  if (rule.conditions?.requirePaymentTypeIn && !rule.conditions.requirePaymentTypeIn.includes(paymentType as any)) return;

  const ctx = {
    customer,
    subscription,
    plan: subscription?.plan || null,
    payment: effectivePayment,
    paymentType
  };

  const missing = extractTemplatePaths([template.content || "", template.chatwootTemplate || null]).filter((p) => {
    const v = getPath(ctx, p);
    return v == null || v === "";
  });
  if (missing.length) {
    await systemLog(LogLevel.WARN, "notifications.render", "Variables sin datos en plantilla", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger,
      customerId: customer.id,
      subscriptionId: subscription?.id ?? null,
      paymentId: effectivePayment?.id ?? null,
      missing
    }).catch(() => {});
  }

  const content = template.content ? renderTemplate(template.content, ctx) : "(template)";
  const dk = dedupeKey({
    trigger: parsed.data.trigger,
    ruleId: rule.id,
    subscriptionId: subscription?.id,
    paymentId: effectivePayment?.id,
    cycleNumber: parsed.data.cycleNumber,
    offsetSeconds: parsed.data.offsetSeconds
  });

  // Best-effort dedupe (without a DB-level constraint): if the same message exists recently, skip.
  const existing = await prisma.chatwootMessage.findFirst({
    where: {
      customerId: customer.id,
      subscriptionId: subscription?.id ?? effectivePayment?.subscriptionId ?? null,
      paymentId: effectivePayment?.id ?? null,
      type: template.chatwootType as ChatwootMessageType,
      content,
      status: { in: [MessageStatus.PENDING, MessageStatus.SENT] },
      createdAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60_000) }
    },
    select: { id: true }
  });
  if (existing) return;

  const created = await prisma.chatwootMessage.create({
    data: {
      customerId: customer.id,
      subscriptionId: subscription?.id ?? effectivePayment?.subscriptionId ?? null,
      paymentId: effectivePayment?.id ?? null,
      type: template.chatwootType as ChatwootMessageType,
      status: MessageStatus.PENDING,
      content,
      providerResp: template.chatwootTemplate
        ? ({ template_params: renderAny(template.chatwootTemplate, ctx) } as any)
        : null
    }
  });

  await prisma.retryJob.create({
    data: {
      type: RetryJobType.SEND_CHATWOOT_MESSAGE,
      payload: { chatwootMessageId: created.id }
    }
  });

  await systemLog(LogLevel.INFO, "notifications.dispatch", "Mensaje en cola para envio", {
    trigger: parsed.data.trigger,
    ruleId: parsed.data.ruleId,
    chatwootMessageId: created.id,
    customerId: customer.id,
    paymentId: effectivePayment?.id ?? null
  }).catch(() => {});

  if (parsed.data.trigger === "PAYMENT_DECLINED" && subscription) {
    // Optional: mark past-due for visibility (best-effort).
    if (subscription.status !== SubscriptionStatus.CANCELED && subscription.status !== SubscriptionStatus.EXPIRED) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.PAST_DUE }
      }).catch(() => {});
    }
  }
}
