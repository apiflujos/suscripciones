import { ChatwootMessageType, LogLevel, MessageStatus, PaymentStatus, RetryJobType, SubscriptionStatus, PublicCheckoutKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { getNotificationsConfig, notificationTriggerSchema } from "../../services/notificationsConfig";
import { createPaymentLinkForSubscription } from "../../services/subscriptionBilling";
import { systemLog } from "../../services/systemLog";
import { createPublicCheckoutLink } from "../../services/publicCheckoutLinks";
import { sendChatwootMessage } from "./sendChatwootMessage";
import { getDefaultTenantId } from "../../services/tenantContext";
import { formatDateTimeEs } from "../../lib/dates";
import { getAppTimeZone } from "../../services/runtimeConfig";

const payloadSchema = z.object({
  trigger: notificationTriggerSchema,
  ruleId: z.string().min(1),
  offsetSeconds: z.number().int().optional(),
  anchorAt: z.string().datetime().optional(),
  customerId: z.preprocess((v) => {
    if (v == null) return undefined;
    const s = String(v || "").trim();
    return s ? s : undefined;
  }, z.string().uuid().optional()),
  subscriptionId: z.preprocess((v) => {
    if (v == null) return undefined;
    const s = String(v || "").trim();
    return s ? s : undefined;
  }, z.string().uuid().optional()),
  paymentId: z.preprocess((v) => {
    if (v == null) return undefined;
    const s = String(v || "").trim();
    return s ? s : undefined;
  }, z.string().uuid().optional()),
  catalogUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  immediateSend: z.boolean().optional(),
  cycleNumber: z.number().int().positive().optional(),
  paymentStatus: z.enum(["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"]).optional(),
  paymentType: z.enum(["PLAN", "SUBSCRIPTION", "LINK"]).optional()
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
  const tz = String(ctx?.__tz || "America/Bogota");
  return String(content || "").replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path) => {
    const v = getPath(ctx, String(path || ""));
    if (v == null) return "";
    if (v instanceof Date) return formatDateTimeEs(v, tz);
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

async function resolveAutoCheckoutTemplateId(args: {
  tenantId: string;
  trigger: string;
  paymentType: string;
  planId?: string | null;
}): Promise<string | null> {
  const { tenantId, trigger, paymentType, planId } = args;
  if (!tenantId) return null;
  const templates = await prisma.publicCheckoutTemplate.findMany({
    where: { tenantId, active: true },
    orderBy: { updatedAt: "desc" }
  });
  if (!templates.length) return null;
  let desired: PublicCheckoutKind = PublicCheckoutKind.PLAN;
  if (trigger === "CATALOG_LINK_CREATED") desired = PublicCheckoutKind.CART;
  else if (trigger === "TOKENIZATION_LINK_CREATED") desired = PublicCheckoutKind.SUBSCRIPTION;
  else if (String(paymentType).toUpperCase() === "SUBSCRIPTION") desired = PublicCheckoutKind.SUBSCRIPTION;
  else desired = PublicCheckoutKind.PLAN;

  const byKind = templates.filter((t) => t.kind === desired);
  if (desired === PublicCheckoutKind.CART) {
    const pick = byKind[0] || null;
    return pick?.id ? String(pick.id) : null;
  }

  if (!planId) return null;
  const match = byKind.find((t) => Array.isArray(t.productIds) && t.productIds.length === 1 && String(t.productIds[0]) === String(planId));
  return match?.id ? String(match.id) : null;
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
    if (mode === "AUTO_LINK") return "LINK";
    if (mode === "AUTO_DEBIT") return "SUBSCRIPTION";
    return "SUBSCRIPTION";
  }
  if (args.payment?.subscriptionId) return "SUBSCRIPTION";
  return "LINK";
}

export async function subscriptionReminder(payload: any) {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Payload inválido para notificación", {
      errors: parsed.error.flatten(),
      rawPayload: payload
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }

  const cfg = await getNotificationsConfig();
  const rule = cfg.rules.find((r) => r.id === parsed.data.ruleId);
  if (!rule || !rule.enabled) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Regla inactiva o no encontrada", {
      ruleId: parsed.data.ruleId,
      trigger: parsed.data.trigger,
      jobId: (payload as any)?.jobId || null
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }
  const template = cfg.templates.find((t) => t.id === rule.templateId);
  if (!template) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Plantilla no encontrada", {
      ruleId: rule.id,
      templateId: rule.templateId,
      trigger: parsed.data.trigger
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }

  await systemLog(LogLevel.INFO, "notifications.dispatch", "Procesando notificacion", {
    trigger: parsed.data.trigger,
    ruleId: parsed.data.ruleId,
    templateId: template.id,
    customerId: parsed.data.customerId || null,
    subscriptionId: parsed.data.subscriptionId || null,
    paymentId: parsed.data.paymentId || null,
    offsetSeconds: parsed.data.offsetSeconds,
    anchorAt: parsed.data.anchorAt,
    cycleNumber: parsed.data.cycleNumber
  }, "job:subscriptionReminder").catch(() => {});

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

  if (!customer) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Contacto no encontrado", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger,
      customerId: parsed.data.customerId || null,
      subscriptionId: parsed.data.subscriptionId || null,
      paymentId: parsed.data.paymentId || null
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }

  if (subscription && rule.conditions?.skipIfSubscriptionStatusIn?.includes(subscription.status as any)) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Suscripción omitida por estado", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger,
      subscriptionId: subscription.id,
      status: subscription.status
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }

  if (payment) {
    if (rule.conditions?.skipIfPaymentStatusIn?.includes(payment.status as any)) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Pago omitido por estado", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        paymentId: payment.id,
        status: payment.status
      }, "job:subscriptionReminder").catch(() => {});
      return;
    }
    if (rule.conditions?.requirePaymentStatusIn && !rule.conditions.requirePaymentStatusIn.includes(payment.status as any)) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Pago no cumple estado requerido", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        paymentId: payment.id,
        status: payment.status,
        required: rule.conditions.requirePaymentStatusIn
      }, "job:subscriptionReminder").catch(() => {});
      return;
    }
  }

  // Guard against old scheduled reminders after renewal: cycle/anchor must still match.
  if (subscription && parsed.data.trigger === "SUBSCRIPTION_DUE") {
    if (typeof parsed.data.cycleNumber === "number" && subscription.currentCycle !== parsed.data.cycleNumber) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Ciclo desactualizado; notificación omitida", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        subscriptionId: subscription.id,
        currentCycle: subscription.currentCycle,
        payloadCycle: parsed.data.cycleNumber
      }, "job:subscriptionReminder").catch(() => {});
      return;
    }
    if (parsed.data.anchorAt) {
      const anchorIso = new Date(parsed.data.anchorAt).toISOString();
      if (subscription.currentPeriodEndAt.toISOString() !== anchorIso) {
        await systemLog(LogLevel.WARN, "notifications.dispatch", "Fecha de corte no coincide; notificación omitida", {
          ruleId: rule.id,
          templateId: template.id,
          trigger: parsed.data.trigger,
          subscriptionId: subscription.id,
          currentAnchor: subscription.currentPeriodEndAt.toISOString(),
          payloadAnchor: anchorIso
        }, "job:subscriptionReminder").catch(() => {});
        return;
      }
    }

    // Skip reminders if the upcoming cycle payment is already approved.
    const cycle = parsed.data.cycleNumber ?? subscription.currentCycle;
    const approved = await prisma.payment.findUnique({
      where: { subscriptionCycleKey: `${subscription.id}:${cycle}` },
      select: { status: true }
    });
    if (approved?.status === PaymentStatus.APPROVED) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Pago ya aprobado; recordatorio omitido", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        subscriptionId: subscription.id,
        paymentStatus: approved.status
      }, "job:subscriptionReminder").catch(() => {});
      return;
    }
  }

  if (template.channel === "META") {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "META template dispatch not implemented; skipping", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }

  if (!template.chatwootType) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Tipo de mensaje no definido", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }

  const requiresWhatsappTemplate = [
    "PAYMENT_LINK_CREATED",
    "TOKENIZATION_LINK_CREATED",
    "PAYMENT_APPROVED",
    "PAYMENT_DECLINED",
    "CATALOG_LINK_CREATED"
  ].includes(parsed.data.trigger);
  if (requiresWhatsappTemplate && !String(template.chatwootTemplate?.name || "").trim()) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Plantilla WhatsApp no configurada", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }

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
        }, "job:subscriptionReminder").catch(() => {});
      }
    }
  }

  const paymentType = parsed.data.paymentType || getPaymentType({ subscription, payment: effectivePayment || payment });

  if (rule.conditions?.requirePaymentTypeIn && !rule.conditions.requirePaymentTypeIn.includes(paymentType as any)) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Tipo de pago no permitido por la regla", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger,
      paymentType
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }

  if (parsed.data.trigger === "PAYMENT_APPROVED") {
    const approved = effectivePayment?.status === PaymentStatus.APPROVED && Boolean(effectivePayment?.paidAt);
    if (!approved) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Pago aprobado omitido: estado no aprobado", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        paymentId: effectivePayment?.id ?? parsed.data.paymentId ?? null,
        paymentStatus: effectivePayment?.status ?? null
      }, "job:subscriptionReminder").catch(() => {});
      return;
    }
  }
  if (parsed.data.trigger === "PAYMENT_DECLINED") {
    const failed = effectivePayment && [PaymentStatus.DECLINED, PaymentStatus.ERROR, PaymentStatus.VOIDED].includes(effectivePayment.status);
    if (!failed) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Pago fallido omitido: estado no fallido", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        paymentId: effectivePayment?.id ?? parsed.data.paymentId ?? null,
        paymentStatus: effectivePayment?.status ?? null
      }, "job:subscriptionReminder").catch(() => {});
      return;
    }
  }

  const meta: any = customer?.metadata && typeof customer.metadata === "object" ? (customer.metadata as any) : {};
  const templatePaths = extractTemplatePaths([template.content || "", template.chatwootTemplate || null]);
  const checkoutIds = Array.from(
    new Set(
      templatePaths
        .filter((p) => p.startsWith("checkoutPublicToken.") || p.startsWith("checkoutPublicName."))
        .map((p) => p.split(".")[1])
        .filter(Boolean)
    )
  );
  const checkoutPublicToken: Record<string, string> = {};
  const checkoutPublicName: Record<string, string> = {};
  const checkoutPublicUrl: Record<string, string> = {};
  if (checkoutIds.length) {
    for (const id of checkoutIds) {
      const planId = subscription?.planId || payment?.subscription?.planId || null;
      const targetId =
        id === "AUTO"
          ? await resolveAutoCheckoutTemplateId({
              tenantId: subscription?.tenantId || payment?.tenantId || "",
              trigger: parsed.data.trigger,
              paymentType,
              planId
            })
          : id;
      if (!targetId) {
        await systemLog(LogLevel.WARN, "notifications.dispatch", "Checkout público automático no disponible", {
          ruleId: rule.id,
          templateId: template.id,
          trigger: parsed.data.trigger,
          customerId: customer.id
        }, "job:subscriptionReminder").catch(() => {});
        return;
      }
      const created = await createPublicCheckoutLink({ customerId: customer.id, templateId: targetId }).catch(() => null);
      if (created?.url) {
        checkoutPublicToken[id] = created.token;
        checkoutPublicName[id] = created.templateName;
        checkoutPublicUrl[id] = created.url;
        if (id === "AUTO") {
          const kind = created.kind;
          if (kind === PublicCheckoutKind.PLAN) checkoutPublicUrl.AUTO_PLAN = created.url;
          if (kind === PublicCheckoutKind.SUBSCRIPTION) checkoutPublicUrl.AUTO_SUBSCRIPTION = created.url;
          if (kind === PublicCheckoutKind.CART) checkoutPublicUrl.AUTO_CART = created.url;
        }
      } else {
        await systemLog(LogLevel.WARN, "notifications.dispatch", "Checkout público no disponible para plantilla", {
          ruleId: rule.id,
          templateId: template.id,
          trigger: parsed.data.trigger,
          customerId: customer.id,
          checkoutTemplateId: targetId
        }, "job:subscriptionReminder").catch(() => {});
        return;
      }
    }
  }
  const centsToPesos = (value?: number | null) => Math.trunc(Number(value || 0) / 100);
  const tokenizationUrl = parsed.data.tokenUrl || meta?.tokenizationLink?.url || "";
  const catalogUrl = parsed.data.catalogUrl || meta?.cartLink?.url || "";
  const planWithPesos = subscription?.plan
    ? { ...subscription.plan, priceInPesos: centsToPesos(subscription.plan.priceInCents) }
    : null;
  const paymentWithPesos = effectivePayment
    ? { ...effectivePayment, amountInPesos: centsToPesos(effectivePayment.amountInCents) }
    : null;
  const timeZone = await getAppTimeZone().catch(() => "America/Bogota");
  const ctx = {
    __tz: timeZone,
    customer,
    subscription,
    plan: planWithPesos,
    payment: paymentWithPesos,
    checkoutPublicToken,
    checkoutPublicName,
    checkoutPublicUrl,
    paymentLink: meta?.paymentLink ?? null,
    tokenizationLink: meta?.tokenizationLink ?? null,
    cartLink: meta?.cartLink ?? null,
    tokenization: tokenizationUrl ? { url: tokenizationUrl } : null,
    catalog: catalogUrl ? { url: catalogUrl } : null,
    paymentType
  };

  const missing = templatePaths.filter((p) => {
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
    }, "job:subscriptionReminder").catch(() => {});
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
  if (existing) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Mensaje duplicado; omitido", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger,
      customerId: customer.id,
      subscriptionId: subscription?.id ?? null,
      paymentId: effectivePayment?.id ?? null
    }, "job:subscriptionReminder").catch(() => {});
    return;
  }

  const resolvedTenantId =
    subscription?.tenantId ?? customer.tenantId ?? effectivePayment?.tenantId ?? (await getDefaultTenantId());
  if (!resolvedTenantId) throw new Error("tenant_required");

  const created = await prisma.chatwootMessage.create({
    data: {
      tenantId: resolvedTenantId,
      customerId: customer.id,
      subscriptionId: subscription?.id ?? effectivePayment?.subscriptionId ?? null,
      paymentId: effectivePayment?.id ?? null,
      type: template.chatwootType as ChatwootMessageType,
      status: MessageStatus.PENDING,
      content,
      actor: "Sistema",
      providerResp: template.chatwootTemplate
        ? ({
            template_params: renderAny(template.chatwootTemplate, ctx),
            meta: {
              trigger: parsed.data.trigger,
              offsetSeconds: parsed.data.offsetSeconds ?? null,
              ruleId: rule.id
            }
          } as any)
        : null
    }
  });

  if (parsed.data.immediateSend) {
    try {
      await sendChatwootMessage(created.id);
    } catch (err: any) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Mensaje fallido", {
        trigger: parsed.data.trigger,
        ruleId: parsed.data.ruleId,
        chatwootMessageId: created.id,
        customerId: customer.id,
        paymentId: effectivePayment?.id ?? null,
        err: err?.message ? String(err.message) : "unknown_error"
      }, "job:subscriptionReminder").catch(() => {});
    }
  } else {
    await prisma.retryJob.create({
      data: {
        type: RetryJobType.SEND_CHATWOOT_MESSAGE,
        payload: { chatwootMessageId: created.id }
      }
    });
  }

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
