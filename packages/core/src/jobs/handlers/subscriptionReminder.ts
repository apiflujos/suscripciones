import { ChatwootMessageType, CredentialProvider, LogLevel, MessageStatus, PaymentStatus, RetryJobType, SubscriptionStatus, PublicCheckoutKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { getCredential } from "../../services/credentials";
import { readCheckoutConfig } from "../../services/checkoutConfig";
import { getNotificationsConfig, notificationTriggerSchema } from "../../services/notificationsConfig";
import { notificationJobPayloadSchema, type NotificationJobPayload } from "../../services/notificationJobPayloads";
import { createPaymentLinkForSubscription } from "../../services/subscriptionBilling";
import { systemLog } from "../../services/systemLog";
import { createPublicCheckoutLink } from "../../services/publicCheckoutLinks";
import { sendChatwootMessage } from "./sendChatwootMessage";
import { getDefaultTenantId } from "../../services/tenantContext";
import { formatDateTimeEs } from "../../lib/dates";
import { getAutoDebitConfig, getAppTimeZone } from "../../services/runtimeConfig";
import { logger } from "../../lib/logger";
import { resolveSubscriptionBillingState } from "../../services/billingCycles";
import {
  extractProcessedParamValues,
  normalizeProcessedTemplateParams
} from "../../services/chatwootTemplates";
import { resolveSubscriptionCollectionMode } from "../../services/subscriptionMode";
import { readCustomerMetadata } from "../../lib/customerMetadata";

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

function formatCycleLabel(value: Date | null | undefined, timeZone: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
    timeZone
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
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

function hasUsableNotificationTemplate(template: any) {
  return Boolean(String(template?.chatwootTemplate?.name || "").trim());
}

async function resolveAutoCheckoutTemplateId(args: {
  tenantId: string;
  trigger: string;
  paymentType: string;
  planId?: string | null;
  productId?: string | null;
}): Promise<string | null> {
  const { tenantId, trigger, paymentType, planId, productId } = args;
  if (!tenantId) return null;
  const templates = await prisma.publicCheckoutTemplate.findMany({
    where: { tenantId, active: true },
    orderBy: { updatedAt: "desc" }
  });
  if (!templates.length) return null;
  let desired: PublicCheckoutKind = PublicCheckoutKind.PLAN;
  if (trigger === "CATALOG_LINK_CREATED") desired = PublicCheckoutKind.CART;
  else if (trigger === "TOKENIZATION_LINK_CREATED") desired = PublicCheckoutKind.SUBSCRIPTION;
  // PAYMENT_LINK_CREATED always uses PLAN template (it's a payment link, not tokenization)
  // even when paymentType=SUBSCRIPTION. The SUBSCRIPTION kind is only for tokenization links.
  else desired = PublicCheckoutKind.PLAN;

  const byKind = templates.filter((t) => t.kind === desired);
  const extractProductId = (entry: any) => {
    if (!entry) return "";
    if (typeof entry === "string") return String(entry).trim();
    if (typeof entry === "object") return String(entry?.id || "").trim();
    return "";
  };
  let resolvedProductId = String(productId || "").trim();
  if (!resolvedProductId && planId) {
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      select: { catalogProductId: true, metadata: true }
    });
    resolvedProductId = String((plan as any)?.catalogProductId || (plan?.metadata as any)?.catalog?.itemId || "");
  }
  if (resolvedProductId) {
    const match = byKind.find((t) => {
      const list = Array.isArray(t.productIds) ? t.productIds : [];
      return list.some((entry: any) => String(extractProductId(entry)) === String(resolvedProductId));
    });
    if (match?.id) return String(match.id);
  }

  let defaultTemplateId = "";
  try {
    const rawCfg = await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG");
    const cfg = readCheckoutConfig(rawCfg);
    defaultTemplateId =
      desired === PublicCheckoutKind.CART
        ? String(cfg?.defaultCartTemplateId || "").trim()
        : desired === PublicCheckoutKind.SUBSCRIPTION
          ? String(cfg?.defaultSubscriptionTemplateId || "").trim()
          : String(cfg?.defaultPlanTemplateId || "").trim();
  } catch {
    defaultTemplateId = "";
  }
  if (!defaultTemplateId) return null;
  const fallback = byKind.find((t) => String(t?.id || "").trim() === defaultTemplateId) || null;
  return fallback?.id ? String(fallback.id) : null;
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

function extractPlaceholderIndexes(value: unknown): number[] {
  if (typeof value !== "string") return [];
  const matches = value.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  return matches
    .map((match) => {
      const num = Number(match.replace(/[^\d]/g, ""));
      return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
    })
    .filter((num) => num > 0);
}

function countPlaceholderSlotsFromText(value: unknown) {
  const indexes = extractPlaceholderIndexes(value);
  return indexes.length ? Math.max(...indexes) : 0;
}

function countPlaceholderSlotsFromExample(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, countPlaceholderSlotsFromExample(item)), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (max, item) => Math.max(max, countPlaceholderSlotsFromExample(item)),
      0
    );
  }
  return 0;
}

function countExampleValueSlots(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((max, item) => {
    if (Array.isArray(item)) return Math.max(max, item.filter((entry) => entry != null && String(entry).trim() !== "").length);
    if (item && typeof item === "object") return Math.max(max, countExampleValueSlots(Object.values(item)));
    return max;
  }, 0);
}

function countBodyParams(components: any[], currentCount: number) {
  const body = components.find((component: any) => String(component?.type || "").toUpperCase() === "BODY") as any;
  if (!body) return 0;
  const countByText = countPlaceholderSlotsFromText(body?.text);
  const countByExample = Math.max(
    countPlaceholderSlotsFromExample(body?.example),
    countExampleValueSlots(body?.example?.body_text)
  );
  return Math.max(countByText, countByExample, currentCount);
}

function countHeaderParams(components: any[], currentCount: number) {
  const header = components.find((component: any) => String(component?.type || "").toUpperCase() === "HEADER") as any;
  if (!header) return 0;
  const format = String(header?.format || header?.format_type || "").toUpperCase();
  if (format && format !== "TEXT") return 0;
  const countByText = countPlaceholderSlotsFromText(header?.text);
  const countByExample = Math.max(
    countPlaceholderSlotsFromExample(header?.example),
    Array.isArray(header?.example?.header_text)
      ? header.example.header_text.filter((entry: unknown) => entry != null && String(entry).trim() !== "").length
      : 0
  );
  return Math.max(countByText, countByExample, currentCount);
}

function countButtonParams(components: any[], currentCount: number) {
  const buttons = components.find((component: any) => String(component?.type || "").toUpperCase() === "BUTTONS") as any;
  if (!buttons || !Array.isArray(buttons?.buttons)) return 0;
  const urlButtons = buttons.buttons.filter((button: any) => String(button?.type || "").toUpperCase() === "URL");
  const inferred = urlButtons.reduce((count: number, button: any) => {
    const hasPlaceholder = countPlaceholderSlotsFromText(button?.url) > 0;
    const hasExample = countPlaceholderSlotsFromExample(button?.example) > 0;
    return count + (hasPlaceholder || hasExample ? 1 : 0);
  }, 0);
  return Math.max(inferred, currentCount);
}

function validateRenderedTemplateParams(templateParams: any, templateMeta: any) {
  const components = Array.isArray(templateMeta?.components) ? templateMeta.components : [];
  if (!components.length) return;
  const processed = templateParams?.processed_params || {};
  const bodyParams = extractProcessedParamValues(processed?.body, "body");
  const headerParams = extractProcessedParamValues(processed?.header, "header");
  const buttonParams = extractProcessedParamValues(processed?.buttons, "buttons");
  const requiredBody = countBodyParams(components, bodyParams.length);
  const requiredHeader = countHeaderParams(components, headerParams.length);
  const requiredButtons = countButtonParams(components, buttonParams.length);
  const completeBody = bodyParams.length === requiredBody && bodyParams.every(Boolean);
  const completeHeader = headerParams.length === requiredHeader && headerParams.every(Boolean);
  const completeButtons = buttonParams.length === requiredButtons && buttonParams.every(Boolean);
  const missingSections: string[] = [];
  if (!completeBody) missingSections.push(`body:${requiredBody}`);
  if (!completeHeader) missingSections.push(`header:${requiredHeader}`);
  if (!completeButtons) missingSections.push(`buttons:${requiredButtons}`);
  if (missingSections.length) {
    throw new Error(`missing_template_params:${missingSections.join(",")}`);
  }
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
    // Usa resolveSubscriptionCollectionMode para leer correctamente desde
    // subscription.metadata (preferido) y plan.metadata (fallback).
    const mode = resolveSubscriptionCollectionMode(sub);
    if (mode === "AUTO_DEBIT") return "SUBSCRIPTION";
    // AUTO_LINK y MANUAL_LINK → link de pago (plantilla tipo PLAN)
    return "LINK";
  }
  const paymentSubscription = args.payment?.subscription;
  if (paymentSubscription?.plan) {
    const mode = resolveSubscriptionCollectionMode(paymentSubscription);
    if (mode === "AUTO_DEBIT") return "SUBSCRIPTION";
    return "LINK";
  }
  if (args.payment?.subscriptionId) return "SUBSCRIPTION";
  return "LINK";
}

export async function subscriptionReminder(payload: unknown): Promise<{ ok: boolean; sent?: boolean; queued?: boolean; skipped?: boolean; error?: string }> {
  const parsed = notificationJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Payload inválido para notificación", {
      errors: parsed.error.flatten(),
      rawPayload: payload
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err }, "subscriptionReminder: fallo escribiendo systemLog de payload inválido");
    });
    return { ok: false, skipped: true, error: "invalid_payload" };
  }

  const cfg = await getNotificationsConfig();
  const rule = cfg.rules.find((r) => r.id === parsed.data.ruleId);
  if (!rule || !rule.enabled) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Regla inactiva o no encontrada", {
      ruleId: parsed.data.ruleId,
      trigger: parsed.data.trigger,
      jobId: typeof payload === "object" && payload && "jobId" in (payload as Record<string, unknown>) ? (payload as Record<string, unknown>).jobId : null
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err, ruleId: parsed.data.ruleId }, "subscriptionReminder: fallo escribiendo systemLog de regla inactiva");
    });
    return { ok: false, skipped: true, error: "rule_inactive" };
  }
  const template = cfg.templates.find((t) => t.id === rule.templateId);
  if (!template) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Plantilla no encontrada", {
      ruleId: rule.id,
      templateId: rule.templateId,
      trigger: parsed.data.trigger
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err, ruleId: rule.id, templateId: rule.templateId }, "subscriptionReminder: fallo escribiendo systemLog de plantilla faltante");
    });
    return { ok: false, skipped: true, error: "template_missing" };
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
    cycleNumber: parsed.data.trigger === "SUBSCRIPTION_DUE" ? parsed.data.cycleNumber : undefined
  }, "job:subscriptionReminder").catch((err: any) => {
    logger.warn({ err, trigger: parsed.data.trigger, ruleId: parsed.data.ruleId }, "subscriptionReminder: fallo escribiendo systemLog de inicio");
  });

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
  const subscriptionBillingState = subscription ? await resolveSubscriptionBillingState({ subscriptionId: subscription.id }) : null;
  const activeCycle = subscriptionBillingState?.activeCycle || null;
  const collectionCycle = subscriptionBillingState?.collectionCycle || activeCycle;
  const cycleNumberForLogs = parsed.data.trigger === "SUBSCRIPTION_DUE" ? parsed.data.cycleNumber : undefined;

  if (!customer) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Contacto no encontrado", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger,
      customerId: parsed.data.customerId || null,
      subscriptionId: parsed.data.subscriptionId || null,
      paymentId: parsed.data.paymentId || null
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err, ruleId: rule.id }, "subscriptionReminder: fallo escribiendo systemLog de customer faltante");
    });
    return { ok: false, skipped: true, error: "customer_missing" };
  }

  const shouldSkipBySubscriptionStatus =
    subscription &&
    rule.conditions?.skipIfSubscriptionStatusIn?.includes(subscription.status as any) &&
    (
      parsed.data.trigger !== "SUBSCRIPTION_DUE" ||
      ["CANCELED", "SUSPENDED", "EXPIRED"].includes(String(subscription.status || "").toUpperCase())
    );

  if (shouldSkipBySubscriptionStatus) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Suscripción omitida por estado", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        subscriptionId: subscription.id,
        status: subscription.status
      }, "job:subscriptionReminder").catch((err: any) => {
        logger.warn({ err, subscriptionId: subscription.id, status: subscription.status }, "subscriptionReminder: fallo escribiendo systemLog de suscripción omitida");
      });
      return { ok: false, skipped: true, error: "subscription_status_skipped" };
    }

  if (payment) {
    if (rule.conditions?.skipIfPaymentStatusIn?.includes(payment.status as any)) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Pago omitido por estado", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        paymentId: payment.id,
        status: payment.status
      }, "job:subscriptionReminder").catch((err: any) => {
        logger.warn({ err, paymentId: payment.id, status: payment.status }, "subscriptionReminder: fallo escribiendo systemLog de pago omitido");
      });
      return { ok: false, skipped: true, error: "payment_status_skipped" };
    }
    if (rule.conditions?.requirePaymentStatusIn && !rule.conditions.requirePaymentStatusIn.includes(payment.status as any)) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Pago no cumple estado requerido", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        paymentId: payment.id,
        status: payment.status,
        required: rule.conditions.requirePaymentStatusIn
      }, "job:subscriptionReminder").catch((err: any) => {
        logger.warn({ err, paymentId: payment.id, status: payment.status }, "subscriptionReminder: fallo escribiendo systemLog de estado requerido");
      });
      return { ok: false, skipped: true, error: "payment_status_not_allowed" };
    }
  }

  // Guard against old scheduled reminders after renewal: cycle/anchor must still match.
  if (subscription && parsed.data.trigger === "SUBSCRIPTION_DUE") {
    if (!collectionCycle) return { ok: false, skipped: true, error: "missing_collection_cycle" };
    if (typeof parsed.data.cycleNumber === "number" && collectionCycle.cycleNumber !== parsed.data.cycleNumber) {
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Ciclo desactualizado; notificación omitida", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        subscriptionId: subscription.id,
        currentCycle: collectionCycle.cycleNumber,
        payloadCycle: parsed.data.cycleNumber
      }, "job:subscriptionReminder").catch((err: any) => {
        logger.warn({ err, subscriptionId: subscription.id, currentCycle: collectionCycle.cycleNumber }, "subscriptionReminder: fallo escribiendo systemLog de ciclo desactualizado");
      });
      return { ok: false, skipped: true, error: "cycle_mismatch" };
    }
    if (parsed.data.anchorAt) {
      const anchorIso = new Date(parsed.data.anchorAt).toISOString();
      const currentAnchor = new Date(collectionCycle.dueAt || collectionCycle.periodEndAt).toISOString();
      if (currentAnchor !== anchorIso) {
        await systemLog(LogLevel.WARN, "notifications.dispatch", "Fecha de corte no coincide; notificación omitida", {
          ruleId: rule.id,
          templateId: template.id,
          trigger: parsed.data.trigger,
          subscriptionId: subscription.id,
          currentAnchor,
          payloadAnchor: anchorIso
        }, "job:subscriptionReminder").catch((err: any) => {
          logger.warn({ err, subscriptionId: subscription.id, anchorIso }, "subscriptionReminder: fallo escribiendo systemLog de anchor desalineado");
        });
        return { ok: false, skipped: true, error: "anchor_mismatch" };
      }
    }

    // Skip reminders if the upcoming cycle payment is already approved.
    const cycle = parsed.data.cycleNumber ?? collectionCycle.cycleNumber;
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
      }, "job:subscriptionReminder").catch((err: any) => {
        logger.warn({ err, subscriptionId: subscription.id }, "subscriptionReminder: fallo escribiendo systemLog de pago ya aprobado");
      });
      return { ok: false, skipped: true, error: "already_paid" };
    }
  }

  if (template.channel === "META") {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "META template dispatch not implemented; skipping", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err, ruleId: rule.id, templateId: template.id }, "subscriptionReminder: fallo escribiendo systemLog de META no soportado");
    });
    return { ok: false, skipped: true, error: "meta_not_supported" };
  }

  if (!template.chatwootType) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Tipo de mensaje no definido", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err, ruleId: rule.id, templateId: template.id }, "subscriptionReminder: fallo escribiendo systemLog de tipo faltante");
    });
    return { ok: false, skipped: true, error: "chatwoot_type_missing" };
  }

  if (!hasUsableNotificationTemplate(template)) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Plantilla WhatsApp no configurada", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err, ruleId: rule.id, templateId: template.id }, "subscriptionReminder: fallo escribiendo systemLog de plantilla WhatsApp faltante");
    });
    return { ok: false, skipped: true, error: "whatsapp_template_missing" };
  }

  let effectivePayment: any = payment;
  if (rule.ensurePaymentLink && subscription && parsed.data.trigger === "SUBSCRIPTION_DUE") {
    const cycle = parsed.data.cycleNumber ?? collectionCycle?.cycleNumber ?? activeCycle?.cycleNumber ?? 1;
    const subscriptionCycleKey = `${subscription.id}:${cycle}`;
    effectivePayment = await prisma.payment
      .findUnique({ where: { subscriptionCycleKey }, include: { customer: true, subscription: true } })
      .catch(() => null as any);
    if (!effectivePayment?.checkoutUrl) {
      try {
        const created = await createPaymentLinkForSubscription({ subscriptionId: subscription.id, sendNotifications: false });
        effectivePayment = await prisma.payment.findUnique({ where: { id: created.paymentId }, include: { customer: true, subscription: true } });
      } catch (err: any) {
        await systemLog(LogLevel.WARN, "notifications.dispatch", "ensurePaymentLink failed; continuing without link", {
          subscriptionId: subscription.id,
          err: err?.message ? String(err.message) : "unknown error"
        }, "job:subscriptionReminder").catch((logErr: any) => {
          logger.warn({ err: logErr, subscriptionId: subscription.id }, "subscriptionReminder: fallo escribiendo systemLog de ensurePaymentLink");
        });
      }
    }
  }

  const paymentType = ("paymentType" in parsed.data ? parsed.data.paymentType : undefined) || getPaymentType({ subscription, payment: effectivePayment || payment });

  if (rule.conditions?.requirePaymentTypeIn && !rule.conditions.requirePaymentTypeIn.includes(paymentType as any)) {
    await systemLog(LogLevel.WARN, "notifications.dispatch", "Tipo de pago no permitido por la regla", {
      ruleId: rule.id,
      templateId: template.id,
      trigger: parsed.data.trigger,
      paymentType
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err, paymentType, ruleId: rule.id }, "subscriptionReminder: fallo escribiendo systemLog de tipo de pago no permitido");
    });
    return { ok: false, skipped: true, error: "payment_type_not_allowed" };
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
      }, "job:subscriptionReminder").catch((err: any) => {
        logger.warn({ err, paymentId: effectivePayment?.id ?? parsed.data.paymentId ?? null }, "subscriptionReminder: fallo escribiendo systemLog de pago no aprobado");
      });
      return { ok: false, skipped: true, error: "payment_not_approved" };
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
      }, "job:subscriptionReminder").catch((err: any) => {
        logger.warn({ err, paymentId: effectivePayment?.id ?? parsed.data.paymentId ?? null }, "subscriptionReminder: fallo escribiendo systemLog de pago no fallido");
      });
      return { ok: false, skipped: true, error: "payment_not_declined" };
    }
  }

  const meta = readCustomerMetadata(customer?.metadata);
  const notificationLinkMeta =
    parsed.data.trigger === "TOKENIZATION_LINK_CREATED"
      ? meta?.tokenizationLink
      : parsed.data.trigger === "CATALOG_LINK_CREATED"
        ? meta?.cartLink
        : meta?.paymentLink;
  const templatePaths = extractTemplatePaths([template.content || "", template.chatwootTemplate || null]);
  const checkoutIds = Array.from(
    new Set(
      templatePaths
        .filter((p) => p.startsWith("checkoutPublicToken.") || p.startsWith("checkoutPublicName.") || p.startsWith("checkoutPublicUrl."))
        .map((p) => p.split(".")[1])
        .filter(Boolean)
    )
  );
  const checkoutPublicToken: Record<string, string> = {};
  const checkoutPublicName: Record<string, string> = {};
  const checkoutPublicUrl: Record<string, string> = {};
  if (checkoutIds.length) {
    const tokenizationPayload =
      parsed.data.trigger === "TOKENIZATION_LINK_CREATED" ? parsed.data : null;
    const notificationPlanId =
      notificationLinkMeta && "planId" in notificationLinkMeta
        ? (notificationLinkMeta.planId ?? null)
        : null;
    const notificationProductId =
      notificationLinkMeta && "productId" in notificationLinkMeta
        ? String(notificationLinkMeta.productId || "")
        : "";
    const notificationTenantId =
      notificationLinkMeta && "tenantId" in notificationLinkMeta
        ? String(notificationLinkMeta.tenantId || "").trim()
        : "";
    for (const id of checkoutIds) {
      const normalizedCheckoutId = String(id || "").trim().toUpperCase();
      const planId =
        subscription?.planId ||
        payment?.subscription?.planId ||
        tokenizationPayload?.planId ||
        notificationPlanId ||
        null;
      const productId =
        String((subscription as any)?.productId || "") ||
        String((payment as any)?.subscription?.productId || "") ||
        String(tokenizationPayload?.productId || "") ||
        notificationProductId ||
        String((subscription as any)?.plan?.catalogProductId || (subscription as any)?.plan?.metadata?.catalog?.itemId || "") ||
        String((payment as any)?.subscription?.plan?.catalogProductId || (payment as any)?.subscription?.plan?.metadata?.catalog?.itemId || "");
      const targetId =
        normalizedCheckoutId === "AUTO" ||
        normalizedCheckoutId === "AUTO_PLAN" ||
        normalizedCheckoutId === "AUTO_SUBSCRIPTION" ||
        normalizedCheckoutId === "AUTO_CART"
          ? await resolveAutoCheckoutTemplateId({
              tenantId:
                subscription?.tenantId ||
                payment?.tenantId ||
                String(tokenizationPayload?.tenantId || "").trim() ||
                notificationTenantId,
              trigger: parsed.data.trigger,
              paymentType,
              planId,
              productId
            })
          : id;
      if (!targetId) {
        await systemLog(LogLevel.WARN, "notifications.dispatch", "Checkout público automático no disponible", {
          ruleId: rule.id,
          templateId: template.id,
          trigger: parsed.data.trigger,
          customerId: customer.id
        }, "job:subscriptionReminder").catch((err: any) => {
          logger.warn({ err, customerId: customer.id, ruleId: rule.id }, "subscriptionReminder: fallo escribiendo systemLog de checkout AUTO faltante");
        });
        return { ok: false, skipped: true, error: "checkout_auto_missing" };
      }
      const created = await createPublicCheckoutLink({
        customerId: customer.id,
        templateId: targetId,
        checkoutUrl: effectivePayment?.checkoutUrl || meta?.paymentLink?.checkoutUrl || null,
        planId: subscription?.planId || payment?.subscription?.planId || null,
        productId: productId || null
      }).catch((err: any) => {
        logger.warn({ err, customerId: customer.id, templateId: targetId }, "subscriptionReminder: fallo creando checkout público");
        return null;
      });
      if (created?.url) {
        checkoutPublicToken[id] = created.token;
        checkoutPublicName[id] = created.templateName;
        checkoutPublicUrl[id] = created.url;
        if (id === "AUTO") {
          const kind = created.kind;
          if (kind === PublicCheckoutKind.PLAN) {
            checkoutPublicToken.AUTO_PLAN = created.token;
            checkoutPublicName.AUTO_PLAN = created.templateName;
            checkoutPublicUrl.AUTO_PLAN = created.url;
          }
          if (kind === PublicCheckoutKind.SUBSCRIPTION) {
            checkoutPublicToken.AUTO_SUBSCRIPTION = created.token;
            checkoutPublicName.AUTO_SUBSCRIPTION = created.templateName;
            checkoutPublicUrl.AUTO_SUBSCRIPTION = created.url;
          }
          if (kind === PublicCheckoutKind.CART) {
            checkoutPublicToken.AUTO_CART = created.token;
            checkoutPublicName.AUTO_CART = created.templateName;
            checkoutPublicUrl.AUTO_CART = created.url;
          }
        }
      } else {
        await systemLog(LogLevel.WARN, "notifications.dispatch", "Checkout público no disponible para plantilla", {
          ruleId: rule.id,
          templateId: template.id,
          trigger: parsed.data.trigger,
          customerId: customer.id,
          checkoutTemplateId: targetId
        }, "job:subscriptionReminder").catch((err: any) => {
          logger.warn({ err, customerId: customer.id, templateId: targetId }, "subscriptionReminder: fallo escribiendo systemLog de checkout faltante");
        });
        return { ok: false, skipped: true, error: "checkout_missing" };
      }
    }
  }
  const centsToPesos = (value?: number | null) => Math.trunc(Number(value || 0) / 100);
  const tokenUrlFromPayload = parsed.data.trigger === "TOKENIZATION_LINK_CREATED" ? parsed.data.tokenUrl : "";
  const catalogUrlFromPayload = parsed.data.trigger === "CATALOG_LINK_CREATED" ? parsed.data.catalogUrl : "";
  const autoPlanUrl = String(checkoutPublicUrl.AUTO_PLAN || "").trim();
  const autoSubscriptionUrl = String(checkoutPublicUrl.AUTO_SUBSCRIPTION || "").trim();
  const autoCartUrl = String(checkoutPublicUrl.AUTO_CART || "").trim();
  const directPaymentLinkUrl = String(effectivePayment?.checkoutUrl || "").trim();
  const publicPaymentLinkUrl =
    parsed.data.trigger === "PAYMENT_LINK_CREATED" ? String(parsed.data.paymentLinkUrl || "").trim() : "";
  const directTokenizationLinkUrl = String(tokenUrlFromPayload || "").trim();
  const directCatalogLinkUrl = String(catalogUrlFromPayload || "").trim();
  const effectivePaymentLinkUrl =
    publicPaymentLinkUrl ||
    autoPlanUrl ||
    directPaymentLinkUrl ||
    String(meta?.paymentLink?.url || "").trim();
  const effectiveTokenizationLinkUrl =
    autoSubscriptionUrl ||
    directTokenizationLinkUrl ||
    String(meta?.tokenizationLink?.url || "").trim();
  const effectiveCartLinkUrl =
    autoCartUrl ||
    directCatalogLinkUrl ||
    String(meta?.cartLink?.url || "").trim();
  const effectivePaymentLink = effectivePaymentLinkUrl
    ? {
        ...(meta?.paymentLink ?? {}),
        url: effectivePaymentLinkUrl,
        checkoutUrl: directPaymentLinkUrl || meta?.paymentLink?.checkoutUrl || null
      }
    : (meta?.paymentLink ?? null);
  const effectiveTokenizationLink = effectiveTokenizationLinkUrl
    ? {
        ...(meta?.tokenizationLink ?? {}),
        url: effectiveTokenizationLinkUrl
      }
    : (meta?.tokenizationLink ?? null);
  const effectiveCartLink = effectiveCartLinkUrl
    ? {
        ...(meta?.cartLink ?? {}),
        url: effectiveCartLinkUrl
      }
    : (meta?.cartLink ?? null);
  const tokenizationUrl = directTokenizationLinkUrl || String(effectiveTokenizationLink?.url || "").trim() || "";
  const catalogUrl = directCatalogLinkUrl || String(effectiveCartLink?.url || "").trim() || "";
  const timeZone =
    (await getAutoDebitConfig().then((cfg) => String(cfg?.timeZone || "").trim()).catch(() => "")) ||
    (await getAppTimeZone().catch((err: any) => {
      logger.warn({ err }, "subscriptionReminder: fallo resolviendo zona horaria, usando America/Bogota");
      return "America/Bogota";
    }));
  const activeCycleLabel = activeCycle?.periodStartAt ? formatCycleLabel(activeCycle.periodStartAt, timeZone) : null;
  const collectionCycleLabel = collectionCycle?.periodStartAt
    ? formatCycleLabel(collectionCycle.periodStartAt, timeZone)
    : activeCycleLabel;
  const subscriptionTemplate = subscription
      ? {
        ...subscription,
        activeCycleNumber: activeCycle?.cycleNumber ?? null,
        activeCycleLabel,
        activeCycleStartAt: activeCycle?.periodStartAt ?? null,
        activeCycleEndAt: activeCycle?.periodEndAt ?? null,
        collectionCycleNumber: collectionCycle?.cycleNumber ?? null,
        collectionCycleLabel,
        nextBillingDate: collectionCycle?.dueAt ?? activeCycle?.periodEndAt ?? null,
        currentCycle: activeCycle?.cycleNumber ?? null,
        currentPeriodStartAt: activeCycle?.periodStartAt ?? null,
        currentPeriodEndAt: activeCycle?.periodEndAt ?? null
      }
    : null;
  const planWithPesos = subscription?.plan
    ? { ...subscription.plan, priceInPesos: centsToPesos(subscription.plan.priceInCents) }
    : null;
  const paymentWithPesos = effectivePayment
    ? { ...effectivePayment, amountInPesos: centsToPesos(effectivePayment.amountInCents) }
    : null;
  const ctx = {
    __tz: timeZone,
    customer,
    subscription: subscriptionTemplate,
    plan: planWithPesos,
    payment: paymentWithPesos,
    checkoutPublicToken,
    checkoutPublicName,
    checkoutPublicUrl,
    paymentLink: effectivePaymentLink,
    tokenizationLink: effectiveTokenizationLink,
    cartLink: effectiveCartLink,
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
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err, customerId: customer.id, missing }, "subscriptionReminder: fallo escribiendo systemLog de variables faltantes");
    });
  }

  const content = template.content ? renderTemplate(template.content, ctx) : "(template)";
  const renderedTemplateParams = template.chatwootTemplate ? renderAny(template.chatwootTemplate, ctx) : null;
  const normalizedRenderedTemplateParams = renderedTemplateParams
    ? {
        ...renderedTemplateParams,
        processed_params: normalizeProcessedTemplateParams(
          renderedTemplateParams?.processed_params,
          template?.meta?.components
        )
      }
    : null;
  if (normalizedRenderedTemplateParams) {
    try {
      validateRenderedTemplateParams(normalizedRenderedTemplateParams, template.meta);
    } catch (err: any) {
      const validationError = err?.message ? String(err.message) : "missing_template_params";
      await systemLog(LogLevel.WARN, "notifications.render", "Parámetros faltantes en plantilla WhatsApp", {
        ruleId: rule.id,
        templateId: template.id,
        trigger: parsed.data.trigger,
        customerId: customer.id,
        subscriptionId: subscription?.id ?? null,
        paymentId: effectivePayment?.id ?? null,
        validationError,
        mappedBodyParams: template.chatwootTemplate?.processed_params?.body || [],
        mappedHeaderParams: template.chatwootTemplate?.processed_params?.header || [],
        mappedButtonParams: template.chatwootTemplate?.processed_params?.buttons || [],
        renderedBodyParams: normalizedRenderedTemplateParams?.processed_params?.body || [],
        renderedHeaderParams: normalizedRenderedTemplateParams?.processed_params?.header || [],
        renderedButtonParams: normalizedRenderedTemplateParams?.processed_params?.buttons || [],
        missingVariables: missing
      }, "job:subscriptionReminder").catch((logErr: any) => {
        logger.warn({ err: logErr, customerId: customer.id, validationError }, "subscriptionReminder: fallo escribiendo systemLog de parámetros faltantes");
      });
      throw err;
    }
  }
  const dk = dedupeKey({
    trigger: parsed.data.trigger,
    ruleId: rule.id,
    subscriptionId: subscription?.id,
    paymentId: effectivePayment?.id,
    cycleNumber: cycleNumberForLogs,
    offsetSeconds: parsed.data.offsetSeconds
  });

  // Best-effort dedupe (without a DB-level constraint): if the same message exists recently, skip.
  const existing = await prisma.chatwootMessage.findFirst({
    where: {
      customerId: customer.id,
      subscriptionId: subscription?.id ?? effectivePayment?.subscriptionId ?? null,
      paymentId: effectivePayment?.id ?? null,
      type: template.chatwootType as ChatwootMessageType,
      status: { in: [MessageStatus.PENDING, MessageStatus.SENT] },
      createdAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
      AND: [
        { providerResp: { path: ["meta", "ruleId"], equals: rule.id } as any },
        { providerResp: { path: ["meta", "templateId"], equals: template.id } as any }
      ]
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
    }, "job:subscriptionReminder").catch((err: any) => {
      logger.warn({ err, customerId: customer.id, paymentId: effectivePayment?.id ?? null }, "subscriptionReminder: fallo escribiendo systemLog de mensaje duplicado");
    });
    return { ok: false, skipped: true, error: "duplicate" };
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
      providerResp: normalizedRenderedTemplateParams
        ? ({
            template_params: normalizedRenderedTemplateParams,
            meta: {
              trigger: parsed.data.trigger,
              offsetSeconds: parsed.data.offsetSeconds ?? null,
              ruleId: rule.id,
              paymentType,
              templateId: template.id,
              templateName: template.name,
              missingParams: missing
            }
          } as any)
        : null
    }
  });

  if (parsed?.data?.trigger === "PAYMENT_DECLINED" && subscription) {
    // Optional: mark past-due for visibility (best-effort).
    if (subscription.status !== SubscriptionStatus.CANCELED && subscription.status !== SubscriptionStatus.EXPIRED) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.PAST_DUE }
      }).catch((err: any) => {
        logger.warn({ err, subscriptionId: subscription.id }, "subscriptionReminder: fallo marcando suscripción en PAST_DUE");
      });
    }
  }

  if (parsed.data.immediateSend) {
    try {
      await sendChatwootMessage(created.id);
      const refreshed = await prisma.chatwootMessage.findUnique({
        where: { id: created.id },
        select: { status: true, errorMessage: true }
      });
      if (refreshed?.status !== MessageStatus.SENT) {
        const errorMessage = String(refreshed?.errorMessage || "chatwoot_send_failed");
        await systemLog(LogLevel.WARN, "notifications.dispatch", "Mensaje fallido", {
          trigger: parsed.data.trigger,
          ruleId: parsed.data.ruleId,
          chatwootMessageId: created.id,
          customerId: customer.id,
          paymentId: effectivePayment?.id ?? null,
          err: errorMessage
        }, "job:subscriptionReminder").catch((err: any) => {
          logger.warn({ err, chatwootMessageId: created.id }, "subscriptionReminder: fallo escribiendo systemLog de mensaje fallido");
        });
        return { ok: false, error: errorMessage };
      }
    } catch (err: any) {
      const errorMessage = err?.message ? String(err.message) : "unknown_error";
      await systemLog(LogLevel.WARN, "notifications.dispatch", "Mensaje fallido", {
        trigger: parsed.data.trigger,
        ruleId: parsed.data.ruleId,
        chatwootMessageId: created.id,
        customerId: customer.id,
        paymentId: effectivePayment?.id ?? null,
        err: errorMessage
      }, "job:subscriptionReminder").catch((logErr: any) => {
        logger.warn({ err: logErr, chatwootMessageId: created.id }, "subscriptionReminder: fallo escribiendo systemLog de excepción en envío");
      });
      return { ok: false, error: errorMessage };
    }
    return { ok: true, sent: true };
  } else {
    await prisma.retryJob.create({
      data: {
        type: RetryJobType.SEND_CHATWOOT_MESSAGE,
        payload: { chatwootMessageId: created.id }
      }
    });
    return { ok: true, queued: true };
  }
}
