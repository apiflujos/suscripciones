"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionReminder = subscriptionReminder;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../db/prisma");
const credentials_1 = require("../../services/credentials");
const checkoutConfig_1 = require("../../services/checkoutConfig");
const notificationsConfig_1 = require("../../services/notificationsConfig");
const notificationJobPayloads_1 = require("../../services/notificationJobPayloads");
const subscriptionBilling_1 = require("../../services/subscriptionBilling");
const systemLog_1 = require("../../services/systemLog");
const publicCheckoutLinks_1 = require("../../services/publicCheckoutLinks");
const urlSafety_1 = require("../../services/urlSafety");
const sendChatwootMessage_1 = require("./sendChatwootMessage");
const tenantContext_1 = require("../../services/tenantContext");
const dates_1 = require("../../lib/dates");
const runtimeConfig_1 = require("../../services/runtimeConfig");
const logger_1 = require("../../lib/logger");
const billingCycles_1 = require("../../services/billingCycles");
const chatwootTemplates_1 = require("../../services/chatwootTemplates");
const subscriptionMode_1 = require("../../services/subscriptionMode");
const customerMetadata_1 = require("../../lib/customerMetadata");
function getPath(obj, path) {
    const parts = path.split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (cur == null)
            return undefined;
        cur = cur[p];
    }
    return cur;
}
function renderTemplate(content, ctx) {
    const tz = String(ctx?.__tz || "America/Bogota");
    return String(content || "").replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path) => {
        const v = getPath(ctx, String(path || ""));
        if (v == null)
            return "";
        if (v instanceof Date)
            return (0, dates_1.formatDateTimeEs)(v, tz);
        return String(v);
    });
}
function formatCycleLabel(value, timeZone) {
    if (!value)
        return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return null;
    const formatted = new Intl.DateTimeFormat("es-CO", {
        month: "long",
        year: "numeric",
        timeZone
    }).format(date);
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
function extractTemplatePaths(input) {
    const out = [];
    const walk = (value) => {
        if (typeof value === "string") {
            const matches = value.match(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g) || [];
            for (const m of matches) {
                const path = m.replace(/[{}]/g, "").trim();
                if (path)
                    out.push(path);
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const v of value)
                walk(v);
            return;
        }
        if (value && typeof value === "object") {
            for (const v of Object.values(value))
                walk(v);
        }
    };
    walk(input);
    return Array.from(new Set(out));
}
function hasUsableNotificationTemplate(template) {
    return Boolean(String(template?.chatwootTemplate?.name || "").trim());
}
async function resolveAutoCheckoutTemplateId(args) {
    const { tenantId, trigger, paymentType, planId, productId } = args;
    if (!tenantId)
        return null;
    const templates = await prisma_1.prisma.publicCheckoutTemplate.findMany({
        where: { tenantId, active: true },
        orderBy: { updatedAt: "desc" }
    });
    if (!templates.length)
        return null;
    let desired = client_1.PublicCheckoutKind.PLAN;
    if (trigger === "CATALOG_LINK_CREATED")
        desired = client_1.PublicCheckoutKind.CART;
    else if (trigger === "TOKENIZATION_LINK_CREATED")
        desired = client_1.PublicCheckoutKind.SUBSCRIPTION;
    // PAYMENT_LINK_CREATED always uses PLAN template (it's a payment link, not tokenization)
    // even when paymentType=SUBSCRIPTION. The SUBSCRIPTION kind is only for tokenization links.
    else
        desired = client_1.PublicCheckoutKind.PLAN;
    const byKind = templates.filter((t) => t.kind === desired);
    const extractProductId = (entry) => {
        if (!entry)
            return "";
        if (typeof entry === "string")
            return String(entry).trim();
        if (typeof entry === "object")
            return String(entry?.id || "").trim();
        return "";
    };
    let resolvedProductId = String(productId || "").trim();
    if (!resolvedProductId && planId) {
        const plan = await prisma_1.prisma.subscriptionPlan.findUnique({
            where: { id: planId },
            select: { catalogProductId: true, metadata: true }
        });
        resolvedProductId = String(plan?.catalogProductId || plan?.metadata?.catalog?.itemId || "");
    }
    if (resolvedProductId) {
        const match = byKind.find((t) => {
            const list = Array.isArray(t.productIds) ? t.productIds : [];
            return list.some((entry) => String(extractProductId(entry)) === String(resolvedProductId));
        });
        if (match?.id)
            return String(match.id);
    }
    let defaultTemplateId = "";
    try {
        const rawCfg = await (0, credentials_1.getCredential)(client_1.CredentialProvider.WOMPI, "CHECKOUT_CONFIG");
        const cfg = (0, checkoutConfig_1.readCheckoutConfig)(rawCfg);
        defaultTemplateId =
            desired === client_1.PublicCheckoutKind.CART
                ? String(cfg?.defaultCartTemplateId || "").trim()
                : desired === client_1.PublicCheckoutKind.SUBSCRIPTION
                    ? String(cfg?.defaultSubscriptionTemplateId || "").trim()
                    : String(cfg?.defaultPlanTemplateId || "").trim();
    }
    catch {
        defaultTemplateId = "";
    }
    if (!defaultTemplateId)
        return null;
    const fallback = byKind.find((t) => String(t?.id || "").trim() === defaultTemplateId) || null;
    return fallback?.id ? String(fallback.id) : null;
}
function renderAny(input, ctx) {
    if (input == null)
        return input;
    if (typeof input === "string")
        return renderTemplate(input, ctx);
    if (Array.isArray(input))
        return input.map((v) => renderAny(v, ctx));
    if (typeof input === "object") {
        const out = {};
        for (const [k, v] of Object.entries(input))
            out[k] = renderAny(v, ctx);
        return out;
    }
    return input;
}
function extractPlaceholderIndexes(value) {
    if (typeof value !== "string")
        return [];
    const matches = value.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
    return matches
        .map((match) => {
        const num = Number(match.replace(/[^\d]/g, ""));
        return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
    })
        .filter((num) => num > 0);
}
function countPlaceholderSlotsFromText(value) {
    const indexes = extractPlaceholderIndexes(value);
    return indexes.length ? Math.max(...indexes) : 0;
}
function countPlaceholderSlotsFromExample(value) {
    if (Array.isArray(value)) {
        return value.reduce((max, item) => Math.max(max, countPlaceholderSlotsFromExample(item)), 0);
    }
    if (value && typeof value === "object") {
        return Object.values(value).reduce((max, item) => Math.max(max, countPlaceholderSlotsFromExample(item)), 0);
    }
    return 0;
}
function countExampleValueSlots(value) {
    if (!Array.isArray(value))
        return 0;
    return value.reduce((max, item) => {
        if (Array.isArray(item))
            return Math.max(max, item.filter((entry) => entry != null && String(entry).trim() !== "").length);
        if (item && typeof item === "object")
            return Math.max(max, countExampleValueSlots(Object.values(item)));
        return max;
    }, 0);
}
function countBodyParams(components, currentCount) {
    const body = components.find((component) => String(component?.type || "").toUpperCase() === "BODY");
    if (!body)
        return 0;
    const countByText = countPlaceholderSlotsFromText(body?.text);
    const countByExample = Math.max(countPlaceholderSlotsFromExample(body?.example), countExampleValueSlots(body?.example?.body_text));
    return Math.max(countByText, countByExample, currentCount);
}
function countHeaderParams(components, currentCount) {
    const header = components.find((component) => String(component?.type || "").toUpperCase() === "HEADER");
    if (!header)
        return 0;
    const format = String(header?.format || header?.format_type || "").toUpperCase();
    if (format && format !== "TEXT")
        return 0;
    const countByText = countPlaceholderSlotsFromText(header?.text);
    const countByExample = Math.max(countPlaceholderSlotsFromExample(header?.example), Array.isArray(header?.example?.header_text)
        ? header.example.header_text.filter((entry) => entry != null && String(entry).trim() !== "").length
        : 0);
    return Math.max(countByText, countByExample, currentCount);
}
function countButtonParams(components, currentCount) {
    const buttons = components.find((component) => String(component?.type || "").toUpperCase() === "BUTTONS");
    if (!buttons || !Array.isArray(buttons?.buttons))
        return 0;
    const urlButtons = buttons.buttons.filter((button) => String(button?.type || "").toUpperCase() === "URL");
    const inferred = urlButtons.reduce((count, button) => {
        const hasPlaceholder = countPlaceholderSlotsFromText(button?.url) > 0;
        const hasExample = countPlaceholderSlotsFromExample(button?.example) > 0;
        return count + (hasPlaceholder || hasExample ? 1 : 0);
    }, 0);
    return Math.max(inferred, currentCount);
}
function validateRenderedTemplateParams(templateParams, templateMeta) {
    const components = Array.isArray(templateMeta?.components) ? templateMeta.components : [];
    if (!components.length)
        return;
    const processed = templateParams?.processed_params || {};
    const bodyParams = (0, chatwootTemplates_1.extractProcessedParamValues)(processed?.body, "body");
    const headerParams = (0, chatwootTemplates_1.extractProcessedParamValues)(processed?.header, "header");
    const buttonParams = (0, chatwootTemplates_1.extractProcessedParamValues)(processed?.buttons, "buttons");
    const requiredBody = countBodyParams(components, bodyParams.length);
    const requiredHeader = countHeaderParams(components, headerParams.length);
    const requiredButtons = countButtonParams(components, buttonParams.length);
    const completeBody = bodyParams.length === requiredBody && bodyParams.every(Boolean);
    const completeHeader = headerParams.length === requiredHeader && headerParams.every(Boolean);
    const completeButtons = buttonParams.length === requiredButtons && buttonParams.every(Boolean);
    const missingSections = [];
    if (!completeBody)
        missingSections.push(`body:${requiredBody}`);
    if (!completeHeader)
        missingSections.push(`header:${requiredHeader}`);
    if (!completeButtons)
        missingSections.push(`buttons:${requiredButtons}`);
    if (missingSections.length) {
        throw new Error(`missing_template_params:${missingSections.join(",")}`);
    }
}
function dedupeKey(args) {
    const sub = args.subscriptionId || "-";
    const pay = args.paymentId || "-";
    const cycle = typeof args.cycleNumber === "number" ? String(args.cycleNumber) : "-";
    const off = typeof args.offsetSeconds === "number" ? String(args.offsetSeconds) : "0";
    return `notif:${args.trigger}:${args.ruleId}:${sub}:${cycle}:${pay}:${off}`;
}
function getPaymentType(args) {
    const sub = args.subscription;
    if (sub?.plan) {
        // Usa resolveSubscriptionCollectionMode para leer correctamente desde
        // subscription.metadata (preferido) y plan.metadata (fallback).
        const mode = (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(sub);
        if (mode === "AUTO_DEBIT")
            return "SUBSCRIPTION";
        // AUTO_LINK y MANUAL_LINK → link de pago (plantilla tipo PLAN)
        return "LINK";
    }
    const paymentSubscription = args.payment?.subscription;
    if (paymentSubscription?.plan) {
        const mode = (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(paymentSubscription);
        if (mode === "AUTO_DEBIT")
            return "SUBSCRIPTION";
        return "LINK";
    }
    if (args.payment?.subscriptionId)
        return "SUBSCRIPTION";
    return "LINK";
}
async function subscriptionReminder(payload) {
    const parsed = notificationJobPayloads_1.notificationJobPayloadSchema.safeParse(payload);
    if (!parsed.success) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Payload inválido para notificación", {
            errors: parsed.error.flatten(),
            rawPayload: payload
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err }, "subscriptionReminder: fallo escribiendo systemLog de payload inválido");
        });
        return { ok: false, skipped: true, error: "invalid_payload" };
    }
    const cfg = await (0, notificationsConfig_1.getNotificationsConfig)();
    const rule = cfg.rules.find((r) => r.id === parsed.data.ruleId);
    if (!rule || !rule.enabled) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Regla inactiva o no encontrada", {
            ruleId: parsed.data.ruleId,
            trigger: parsed.data.trigger,
            jobId: typeof payload === "object" && payload && "jobId" in payload ? payload.jobId : null
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, ruleId: parsed.data.ruleId }, "subscriptionReminder: fallo escribiendo systemLog de regla inactiva");
        });
        return { ok: false, skipped: true, error: "rule_inactive" };
    }
    const template = cfg.templates.find((t) => t.id === rule.templateId);
    if (!template) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Plantilla no encontrada", {
            ruleId: rule.id,
            templateId: rule.templateId,
            trigger: parsed.data.trigger
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, ruleId: rule.id, templateId: rule.templateId }, "subscriptionReminder: fallo escribiendo systemLog de plantilla faltante");
        });
        return { ok: false, skipped: true, error: "template_missing" };
    }
    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "notifications.dispatch", "Procesando notificacion", {
        trigger: parsed.data.trigger,
        ruleId: parsed.data.ruleId,
        templateId: template.id,
        customerId: parsed.data.customerId || null,
        subscriptionId: parsed.data.subscriptionId || null,
        paymentId: parsed.data.paymentId || null,
        offsetSeconds: parsed.data.offsetSeconds,
        anchorAt: parsed.data.anchorAt,
        cycleNumber: parsed.data.trigger === "SUBSCRIPTION_DUE" ? parsed.data.cycleNumber : undefined
    }, "job:subscriptionReminder").catch((err) => {
        logger_1.logger.warn({ err, trigger: parsed.data.trigger, ruleId: parsed.data.ruleId }, "subscriptionReminder: fallo escribiendo systemLog de inicio");
    });
    const subscriptionId = parsed.data.subscriptionId;
    const paymentId = parsed.data.paymentId;
    const [subscription, payment] = await Promise.all([
        subscriptionId
            ? prisma_1.prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { customer: true, plan: true } })
            : Promise.resolve(null),
        paymentId ? prisma_1.prisma.payment.findUnique({ where: { id: paymentId }, include: { customer: true, subscription: true } }) : Promise.resolve(null)
    ]);
    const customer = subscription?.customer ||
        payment?.customer ||
        (parsed.data.customerId ? await prisma_1.prisma.customer.findUnique({ where: { id: parsed.data.customerId } }) : null);
    const subscriptionBillingState = subscription ? await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: subscription.id }) : null;
    const activeCycle = subscriptionBillingState?.activeCycle || null;
    const collectionCycle = subscriptionBillingState?.collectionCycle || activeCycle;
    const cycleNumberForLogs = parsed.data.trigger === "SUBSCRIPTION_DUE" ? parsed.data.cycleNumber : undefined;
    if (!customer) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Contacto no encontrado", {
            ruleId: rule.id,
            templateId: template.id,
            trigger: parsed.data.trigger,
            customerId: parsed.data.customerId || null,
            subscriptionId: parsed.data.subscriptionId || null,
            paymentId: parsed.data.paymentId || null
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, ruleId: rule.id }, "subscriptionReminder: fallo escribiendo systemLog de customer faltante");
        });
        return { ok: false, skipped: true, error: "customer_missing" };
    }
    const shouldSkipBySubscriptionStatus = subscription &&
        rule.conditions?.skipIfSubscriptionStatusIn?.includes(subscription.status) &&
        (parsed.data.trigger !== "SUBSCRIPTION_DUE" ||
            ["CANCELED", "SUSPENDED", "EXPIRED"].includes(String(subscription.status || "").toUpperCase()));
    if (shouldSkipBySubscriptionStatus) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Suscripción omitida por estado", {
            ruleId: rule.id,
            templateId: template.id,
            trigger: parsed.data.trigger,
            subscriptionId: subscription.id,
            status: subscription.status
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, subscriptionId: subscription.id, status: subscription.status }, "subscriptionReminder: fallo escribiendo systemLog de suscripción omitida");
        });
        return { ok: false, skipped: true, error: "subscription_status_skipped" };
    }
    if (payment) {
        if (rule.conditions?.skipIfPaymentStatusIn?.includes(payment.status)) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Pago omitido por estado", {
                ruleId: rule.id,
                templateId: template.id,
                trigger: parsed.data.trigger,
                paymentId: payment.id,
                status: payment.status
            }, "job:subscriptionReminder").catch((err) => {
                logger_1.logger.warn({ err, paymentId: payment.id, status: payment.status }, "subscriptionReminder: fallo escribiendo systemLog de pago omitido");
            });
            return { ok: false, skipped: true, error: "payment_status_skipped" };
        }
        if (rule.conditions?.requirePaymentStatusIn && !rule.conditions.requirePaymentStatusIn.includes(payment.status)) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Pago no cumple estado requerido", {
                ruleId: rule.id,
                templateId: template.id,
                trigger: parsed.data.trigger,
                paymentId: payment.id,
                status: payment.status,
                required: rule.conditions.requirePaymentStatusIn
            }, "job:subscriptionReminder").catch((err) => {
                logger_1.logger.warn({ err, paymentId: payment.id, status: payment.status }, "subscriptionReminder: fallo escribiendo systemLog de estado requerido");
            });
            return { ok: false, skipped: true, error: "payment_status_not_allowed" };
        }
    }
    // Guard against old scheduled reminders after renewal: cycle/anchor must still match.
    if (subscription && parsed.data.trigger === "SUBSCRIPTION_DUE") {
        if (!collectionCycle)
            return { ok: false, skipped: true, error: "missing_collection_cycle" };
        if (typeof parsed.data.cycleNumber === "number" && collectionCycle.cycleNumber !== parsed.data.cycleNumber) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Ciclo desactualizado; notificación omitida", {
                ruleId: rule.id,
                templateId: template.id,
                trigger: parsed.data.trigger,
                subscriptionId: subscription.id,
                currentCycle: collectionCycle.cycleNumber,
                payloadCycle: parsed.data.cycleNumber
            }, "job:subscriptionReminder").catch((err) => {
                logger_1.logger.warn({ err, subscriptionId: subscription.id, currentCycle: collectionCycle.cycleNumber }, "subscriptionReminder: fallo escribiendo systemLog de ciclo desactualizado");
            });
            return { ok: false, skipped: true, error: "cycle_mismatch" };
        }
        if (parsed.data.anchorAt) {
            const anchorIso = new Date(parsed.data.anchorAt).toISOString();
            const currentAnchor = new Date(collectionCycle.dueAt || collectionCycle.periodEndAt).toISOString();
            if (currentAnchor !== anchorIso) {
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Fecha de corte no coincide; notificación omitida", {
                    ruleId: rule.id,
                    templateId: template.id,
                    trigger: parsed.data.trigger,
                    subscriptionId: subscription.id,
                    currentAnchor,
                    payloadAnchor: anchorIso
                }, "job:subscriptionReminder").catch((err) => {
                    logger_1.logger.warn({ err, subscriptionId: subscription.id, anchorIso }, "subscriptionReminder: fallo escribiendo systemLog de anchor desalineado");
                });
                return { ok: false, skipped: true, error: "anchor_mismatch" };
            }
        }
        // Skip reminders if the upcoming cycle payment is already approved.
        const cycle = parsed.data.cycleNumber ?? collectionCycle.cycleNumber;
        const approved = await prisma_1.prisma.payment.findUnique({
            where: { subscriptionCycleKey: `${subscription.id}:${cycle}` },
            select: { status: true }
        });
        if (approved?.status === client_1.PaymentStatus.APPROVED) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Pago ya aprobado; recordatorio omitido", {
                ruleId: rule.id,
                templateId: template.id,
                trigger: parsed.data.trigger,
                subscriptionId: subscription.id,
                paymentStatus: approved.status
            }, "job:subscriptionReminder").catch((err) => {
                logger_1.logger.warn({ err, subscriptionId: subscription.id }, "subscriptionReminder: fallo escribiendo systemLog de pago ya aprobado");
            });
            return { ok: false, skipped: true, error: "already_paid" };
        }
    }
    if (template.channel === "META") {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "META template dispatch not implemented; skipping", {
            ruleId: rule.id,
            templateId: template.id,
            trigger: parsed.data.trigger
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, ruleId: rule.id, templateId: template.id }, "subscriptionReminder: fallo escribiendo systemLog de META no soportado");
        });
        return { ok: false, skipped: true, error: "meta_not_supported" };
    }
    if (!template.chatwootType) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Tipo de mensaje no definido", {
            ruleId: rule.id,
            templateId: template.id,
            trigger: parsed.data.trigger
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, ruleId: rule.id, templateId: template.id }, "subscriptionReminder: fallo escribiendo systemLog de tipo faltante");
        });
        return { ok: false, skipped: true, error: "chatwoot_type_missing" };
    }
    if (!hasUsableNotificationTemplate(template)) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Plantilla WhatsApp no configurada", {
            ruleId: rule.id,
            templateId: template.id,
            trigger: parsed.data.trigger
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, ruleId: rule.id, templateId: template.id }, "subscriptionReminder: fallo escribiendo systemLog de plantilla WhatsApp faltante");
        });
        return { ok: false, skipped: true, error: "whatsapp_template_missing" };
    }
    let effectivePayment = payment;
    if (rule.ensurePaymentLink && subscription && parsed.data.trigger === "SUBSCRIPTION_DUE") {
        const cycle = parsed.data.cycleNumber ?? collectionCycle?.cycleNumber ?? activeCycle?.cycleNumber ?? 1;
        const subscriptionCycleKey = `${subscription.id}:${cycle}`;
        effectivePayment = await prisma_1.prisma.payment
            .findUnique({ where: { subscriptionCycleKey }, include: { customer: true, subscription: true } })
            .catch(() => null);
        if (!effectivePayment?.checkoutUrl) {
            try {
                const created = await (0, subscriptionBilling_1.createPaymentLinkForSubscription)({ subscriptionId: subscription.id, sendNotifications: false });
                effectivePayment = await prisma_1.prisma.payment.findUnique({ where: { id: created.paymentId }, include: { customer: true, subscription: true } });
            }
            catch (err) {
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "ensurePaymentLink failed; continuing without link", {
                    subscriptionId: subscription.id,
                    err: err?.message ? String(err.message) : "unknown error"
                }, "job:subscriptionReminder").catch((logErr) => {
                    logger_1.logger.warn({ err: logErr, subscriptionId: subscription.id }, "subscriptionReminder: fallo escribiendo systemLog de ensurePaymentLink");
                });
            }
        }
    }
    const paymentType = ("paymentType" in parsed.data ? parsed.data.paymentType : undefined) || getPaymentType({ subscription, payment: effectivePayment || payment });
    if (rule.conditions?.requirePaymentTypeIn && !rule.conditions.requirePaymentTypeIn.includes(paymentType)) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Tipo de pago no permitido por la regla", {
            ruleId: rule.id,
            templateId: template.id,
            trigger: parsed.data.trigger,
            paymentType
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, paymentType, ruleId: rule.id }, "subscriptionReminder: fallo escribiendo systemLog de tipo de pago no permitido");
        });
        return { ok: false, skipped: true, error: "payment_type_not_allowed" };
    }
    if (parsed.data.trigger === "PAYMENT_APPROVED") {
        const approved = effectivePayment?.status === client_1.PaymentStatus.APPROVED && Boolean(effectivePayment?.paidAt);
        if (!approved) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Pago aprobado omitido: estado no aprobado", {
                ruleId: rule.id,
                templateId: template.id,
                trigger: parsed.data.trigger,
                paymentId: effectivePayment?.id ?? parsed.data.paymentId ?? null,
                paymentStatus: effectivePayment?.status ?? null
            }, "job:subscriptionReminder").catch((err) => {
                logger_1.logger.warn({ err, paymentId: effectivePayment?.id ?? parsed.data.paymentId ?? null }, "subscriptionReminder: fallo escribiendo systemLog de pago no aprobado");
            });
            return { ok: false, skipped: true, error: "payment_not_approved" };
        }
    }
    if (parsed.data.trigger === "PAYMENT_DECLINED") {
        const failed = effectivePayment && [client_1.PaymentStatus.DECLINED, client_1.PaymentStatus.ERROR, client_1.PaymentStatus.VOIDED].includes(effectivePayment.status);
        if (!failed) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Pago fallido omitido: estado no fallido", {
                ruleId: rule.id,
                templateId: template.id,
                trigger: parsed.data.trigger,
                paymentId: effectivePayment?.id ?? parsed.data.paymentId ?? null,
                paymentStatus: effectivePayment?.status ?? null
            }, "job:subscriptionReminder").catch((err) => {
                logger_1.logger.warn({ err, paymentId: effectivePayment?.id ?? parsed.data.paymentId ?? null }, "subscriptionReminder: fallo escribiendo systemLog de pago no fallido");
            });
            return { ok: false, skipped: true, error: "payment_not_declined" };
        }
    }
    const meta = (0, customerMetadata_1.readCustomerMetadata)(customer?.metadata);
    const notificationLinkMeta = parsed.data.trigger === "TOKENIZATION_LINK_CREATED"
        ? meta?.tokenizationLink
        : parsed.data.trigger === "CATALOG_LINK_CREATED"
            ? meta?.cartLink
            : meta?.paymentLink;
    const templatePaths = extractTemplatePaths([template.content || "", template.chatwootTemplate || null]);
    const wantsPaymentPublicLink = templatePaths.some((p) => p === "paymentLink.url" || p === "paymentLink.checkoutUrl" || p === "payment.checkoutUrl");
    const checkoutIds = Array.from(new Set(templatePaths
        .filter((p) => p.startsWith("checkoutPublicToken.") || p.startsWith("checkoutPublicName.") || p.startsWith("checkoutPublicUrl."))
        .map((p) => p.split(".")[1])
        .filter(Boolean)));
    const checkoutPublicToken = {};
    const checkoutPublicName = {};
    const checkoutPublicUrl = {};
    const tokenizationPayload = parsed.data.trigger === "TOKENIZATION_LINK_CREATED" ? parsed.data : null;
    const notificationPlanId = notificationLinkMeta && "planId" in notificationLinkMeta
        ? (notificationLinkMeta.planId ?? null)
        : null;
    const notificationProductId = notificationLinkMeta && "productId" in notificationLinkMeta
        ? String(notificationLinkMeta.productId || "")
        : "";
    const notificationTenantId = notificationLinkMeta && "tenantId" in notificationLinkMeta
        ? String(notificationLinkMeta.tenantId || "").trim()
        : "";
    const createPublicPaymentCheckout = async (targetId) => {
        const productId = String(subscription?.productId || "") ||
            String(payment?.subscription?.productId || "") ||
            String(subscription?.plan?.catalogProductId || subscription?.plan?.metadata?.catalog?.itemId || "") ||
            String(payment?.subscription?.plan?.catalogProductId || payment?.subscription?.plan?.metadata?.catalog?.itemId || "");
        const created = await (0, publicCheckoutLinks_1.createPublicCheckoutLink)({
            customerId: customer.id,
            templateId: targetId,
            checkoutUrl: effectivePayment?.checkoutUrl || meta?.paymentLink?.checkoutUrl || null,
            planId: subscription?.planId || payment?.subscription?.planId || null,
            productId: productId || null
        }).catch((err) => {
            logger_1.logger.warn({ err, customerId: customer.id, templateId: targetId }, "subscriptionReminder: fallo creando checkout publico de pago");
            return null;
        });
        if (created?.url && effectivePayment?.id) {
            await (0, publicCheckoutLinks_1.persistPublicPaymentLinkForPayment)({
                paymentId: effectivePayment.id,
                publicCheckout: created,
                checkoutUrl: effectivePayment.checkoutUrl || meta?.paymentLink?.checkoutUrl || null,
                productId: productId || null,
                amountInCents: effectivePayment.amountInCents,
                currency: effectivePayment.currency
            }).catch((err) => {
                logger_1.logger.warn({ err, paymentId: effectivePayment.id, customerId: customer.id }, "subscriptionReminder: fallo persistiendo checkout publico en pago");
            });
        }
        return created;
    };
    if (checkoutIds.length) {
        for (const id of checkoutIds) {
            const normalizedCheckoutId = String(id || "").trim().toUpperCase();
            const planId = (subscription?.planId ||
                payment?.subscription?.planId ||
                tokenizationPayload?.planId ||
                notificationPlanId ||
                null);
            const productId = String(subscription?.productId || "") ||
                String(payment?.subscription?.productId || "") ||
                String(tokenizationPayload?.productId || "") ||
                notificationProductId ||
                String(subscription?.plan?.catalogProductId || subscription?.plan?.metadata?.catalog?.itemId || "") ||
                String(payment?.subscription?.plan?.catalogProductId || payment?.subscription?.plan?.metadata?.catalog?.itemId || "");
            const targetId = normalizedCheckoutId === "AUTO" ||
                normalizedCheckoutId === "AUTO_PLAN" ||
                normalizedCheckoutId === "AUTO_SUBSCRIPTION" ||
                normalizedCheckoutId === "AUTO_CART"
                ? await resolveAutoCheckoutTemplateId({
                    tenantId: subscription?.tenantId ||
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
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Checkout público automático no disponible", {
                    ruleId: rule.id,
                    templateId: template.id,
                    trigger: parsed.data.trigger,
                    customerId: customer.id
                }, "job:subscriptionReminder").catch((err) => {
                    logger_1.logger.warn({ err, customerId: customer.id, ruleId: rule.id }, "subscriptionReminder: fallo escribiendo systemLog de checkout AUTO faltante");
                });
                return { ok: false, skipped: true, error: "checkout_auto_missing" };
            }
            const created = await (0, publicCheckoutLinks_1.createPublicCheckoutLink)({
                customerId: customer.id,
                templateId: targetId,
                checkoutUrl: effectivePayment?.checkoutUrl || meta?.paymentLink?.checkoutUrl || null,
                planId: subscription?.planId || payment?.subscription?.planId || null,
                productId: productId || null
            }).catch((err) => {
                logger_1.logger.warn({ err, customerId: customer.id, templateId: targetId }, "subscriptionReminder: fallo creando checkout público");
                return null;
            });
            if (created?.url) {
                if (effectivePayment?.id && created.kind === client_1.PublicCheckoutKind.PLAN) {
                    await (0, publicCheckoutLinks_1.persistPublicPaymentLinkForPayment)({
                        paymentId: effectivePayment.id,
                        publicCheckout: created,
                        checkoutUrl: effectivePayment.checkoutUrl || meta?.paymentLink?.checkoutUrl || null,
                        productId: productId || null,
                        amountInCents: effectivePayment.amountInCents,
                        currency: effectivePayment.currency
                    }).catch((err) => {
                        logger_1.logger.warn({ err, paymentId: effectivePayment.id, customerId: customer.id }, "subscriptionReminder: fallo persistiendo checkout publico en pago");
                    });
                }
                checkoutPublicToken[id] = created.token;
                checkoutPublicName[id] = created.templateName;
                checkoutPublicUrl[id] = created.url;
                if (id === "AUTO") {
                    const kind = created.kind;
                    if (kind === client_1.PublicCheckoutKind.PLAN) {
                        checkoutPublicToken.AUTO_PLAN = created.token;
                        checkoutPublicName.AUTO_PLAN = created.templateName;
                        checkoutPublicUrl.AUTO_PLAN = created.url;
                    }
                    if (kind === client_1.PublicCheckoutKind.SUBSCRIPTION) {
                        checkoutPublicToken.AUTO_SUBSCRIPTION = created.token;
                        checkoutPublicName.AUTO_SUBSCRIPTION = created.templateName;
                        checkoutPublicUrl.AUTO_SUBSCRIPTION = created.url;
                    }
                    if (kind === client_1.PublicCheckoutKind.CART) {
                        checkoutPublicToken.AUTO_CART = created.token;
                        checkoutPublicName.AUTO_CART = created.templateName;
                        checkoutPublicUrl.AUTO_CART = created.url;
                    }
                }
            }
            else {
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Checkout público no disponible para plantilla", {
                    ruleId: rule.id,
                    templateId: template.id,
                    trigger: parsed.data.trigger,
                    customerId: customer.id,
                    checkoutTemplateId: targetId
                }, "job:subscriptionReminder").catch((err) => {
                    logger_1.logger.warn({ err, customerId: customer.id, templateId: targetId }, "subscriptionReminder: fallo escribiendo systemLog de checkout faltante");
                });
                return { ok: false, skipped: true, error: "checkout_missing" };
            }
        }
    }
    const payloadPaymentLinkUrl = parsed.data.trigger === "PAYMENT_LINK_CREATED" ? (0, urlSafety_1.normalizeRenderablePublicUrl)(parsed.data.paymentLinkUrl) : "";
    if (wantsPaymentPublicLink && !payloadPaymentLinkUrl && !checkoutPublicUrl.AUTO_PLAN && effectivePayment?.checkoutUrl) {
        const targetId = await resolveAutoCheckoutTemplateId({
            tenantId: subscription?.tenantId || payment?.tenantId || notificationTenantId,
            trigger: "PAYMENT_LINK_CREATED",
            paymentType: "LINK",
            planId: subscription?.planId || payment?.subscription?.planId || null,
            productId: String(subscription?.productId || "") ||
                String(payment?.subscription?.productId || "") ||
                String(subscription?.plan?.catalogProductId || subscription?.plan?.metadata?.catalog?.itemId || "") ||
                String(payment?.subscription?.plan?.catalogProductId || payment?.subscription?.plan?.metadata?.catalog?.itemId || "")
        });
        if (targetId) {
            const created = await createPublicPaymentCheckout(targetId);
            if (created?.url) {
                checkoutPublicToken.AUTO_PLAN = created.token;
                checkoutPublicName.AUTO_PLAN = created.templateName;
                checkoutPublicUrl.AUTO_PLAN = created.url;
            }
        }
    }
    const centsToPesos = (value) => Math.trunc(Number(value || 0) / 100);
    const tokenUrlFromPayload = parsed.data.trigger === "TOKENIZATION_LINK_CREATED" ? parsed.data.tokenUrl : "";
    const catalogUrlFromPayload = parsed.data.trigger === "CATALOG_LINK_CREATED" ? parsed.data.catalogUrl : "";
    const autoPlanUrl = (0, urlSafety_1.normalizeRenderablePublicUrl)(checkoutPublicUrl.AUTO_PLAN);
    const autoSubscriptionUrl = (0, urlSafety_1.normalizeRenderablePublicUrl)(checkoutPublicUrl.AUTO_SUBSCRIPTION);
    const autoCartUrl = (0, urlSafety_1.normalizeRenderablePublicUrl)(checkoutPublicUrl.AUTO_CART);
    const publicPaymentLinkUrl = payloadPaymentLinkUrl;
    const directTokenizationLinkUrl = (0, urlSafety_1.normalizeRenderablePublicUrl)(tokenUrlFromPayload);
    const directCatalogLinkUrl = (0, urlSafety_1.normalizeRenderablePublicUrl)(catalogUrlFromPayload);
    const storedPublicPaymentLinkUrl = (0, urlSafety_1.normalizeRenderablePublicUrl)(meta?.paymentLink?.url);
    const effectivePaymentLinkUrl = publicPaymentLinkUrl ||
        autoPlanUrl ||
        storedPublicPaymentLinkUrl ||
        "";
    const effectiveTokenizationLinkUrl = autoSubscriptionUrl ||
        directTokenizationLinkUrl ||
        (0, urlSafety_1.normalizeRenderablePublicUrl)(meta?.tokenizationLink?.url);
    const effectiveCartLinkUrl = autoCartUrl ||
        directCatalogLinkUrl ||
        (0, urlSafety_1.normalizeRenderablePublicUrl)(meta?.cartLink?.url);
    const effectivePaymentLink = effectivePaymentLinkUrl
        ? {
            ...(meta?.paymentLink ?? {}),
            url: effectivePaymentLinkUrl,
            checkoutUrl: effectivePaymentLinkUrl
        }
        : (meta?.paymentLink ?? null);
    if (wantsPaymentPublicLink && !effectivePaymentLinkUrl) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Link publico de pago no disponible", {
            ruleId: rule.id,
            templateId: template.id,
            trigger: parsed.data.trigger,
            customerId: customer.id,
            subscriptionId: subscription?.id ?? null,
            paymentId: effectivePayment?.id ?? null
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, customerId: customer.id }, "subscriptionReminder: fallo escribiendo systemLog de link publico faltante");
        });
        return { ok: false, skipped: true, error: "payment_public_link_missing" };
    }
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
    const timeZone = (await (0, runtimeConfig_1.getAutoDebitConfig)().then((cfg) => String(cfg?.timeZone || "").trim()).catch(() => "")) ||
        (await (0, runtimeConfig_1.getAppTimeZone)().catch((err) => {
            logger_1.logger.warn({ err }, "subscriptionReminder: fallo resolviendo zona horaria, usando America/Bogota");
            return "America/Bogota";
        }));
    const activeCycleLabel = activeCycle?.periodStartAt ? formatCycleLabel(activeCycle.periodStartAt, timeZone) : null;
    const collectionCycleLabel = collectionCycle?.periodStartAt
        ? formatCycleLabel(collectionCycle.periodStartAt, timeZone)
        : activeCycleLabel;
    const fallbackCollectionCycleLabel = !subscription && parsed.data.trigger === "PAYMENT_LINK_CREATED"
        ? formatCycleLabel(parsed.data.anchorAt || effectivePayment?.createdAt || new Date().toISOString(), timeZone)
        : null;
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
        : fallbackCollectionCycleLabel
            ? {
                status: null,
                activeCycleNumber: null,
                activeCycleLabel: null,
                activeCycleStartAt: null,
                activeCycleEndAt: null,
                collectionCycleNumber: null,
                collectionCycleLabel: fallbackCollectionCycleLabel,
                nextBillingDate: parsed.data.anchorAt || effectivePayment?.createdAt || null,
                currentCycle: null,
                currentPeriodStartAt: null,
                currentPeriodEndAt: null
            }
            : null;
    const planWithPesos = subscription?.plan
        ? { ...subscription.plan, priceInPesos: centsToPesos(subscription.plan.priceInCents) }
        : null;
    const paymentWithPesos = effectivePayment
        ? { ...effectivePayment, checkoutUrl: effectivePaymentLinkUrl || null, amountInPesos: centsToPesos(effectivePayment.amountInCents) }
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
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.render", "Variables sin datos en plantilla", {
            ruleId: rule.id,
            templateId: template.id,
            trigger: parsed.data.trigger,
            customerId: customer.id,
            subscriptionId: subscription?.id ?? null,
            paymentId: effectivePayment?.id ?? null,
            missing
        }, "job:subscriptionReminder").catch((err) => {
            logger_1.logger.warn({ err, customerId: customer.id, missing }, "subscriptionReminder: fallo escribiendo systemLog de variables faltantes");
        });
    }
    const content = template.content ? renderTemplate(template.content, ctx) : "(template)";
    const renderedTemplateParams = template.chatwootTemplate ? renderAny(template.chatwootTemplate, ctx) : null;
    const normalizedRenderedTemplateParams = renderedTemplateParams
        ? {
            ...renderedTemplateParams,
            processed_params: (0, chatwootTemplates_1.normalizeProcessedTemplateParams)(renderedTemplateParams?.processed_params, template?.meta?.components)
        }
        : null;
    // Para auditoría: si no hay contenido propio, construir un resumen con la plantilla
    // y los parámetros renderizados para que quede constancia de qué se envió.
    const auditableContent = template.content
        ? content
        : normalizedRenderedTemplateParams
            ? `[${template.name}] body=${JSON.stringify(normalizedRenderedTemplateParams.processed_params?.body ?? [])}`
            : `[${template.name}]`;
    if (normalizedRenderedTemplateParams) {
        try {
            validateRenderedTemplateParams(normalizedRenderedTemplateParams, template.meta);
        }
        catch (err) {
            const validationError = err?.message ? String(err.message) : "missing_template_params";
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.render", "Parámetros faltantes en plantilla WhatsApp", {
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
            }, "job:subscriptionReminder").catch((logErr) => {
                logger_1.logger.warn({ err: logErr, customerId: customer.id, validationError }, "subscriptionReminder: fallo escribiendo systemLog de parámetros faltantes");
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
    const allowManualImmediateResend = Boolean(parsed.data.immediateSend);
    // Best-effort dedupe (without a DB-level constraint): if the same message exists recently, skip.
    if (!allowManualImmediateResend) {
        const existing = await prisma_1.prisma.chatwootMessage.findFirst({
            where: {
                customerId: customer.id,
                subscriptionId: subscription?.id ?? effectivePayment?.subscriptionId ?? null,
                paymentId: effectivePayment?.id ?? null,
                type: template.chatwootType,
                status: { in: [client_1.MessageStatus.PENDING, client_1.MessageStatus.SENT] },
                createdAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
                AND: [
                    { providerResp: { path: ["meta", "ruleId"], equals: rule.id } },
                    { providerResp: { path: ["meta", "templateId"], equals: template.id } }
                ]
            },
            select: { id: true }
        });
        if (existing) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Mensaje duplicado; omitido", {
                ruleId: rule.id,
                templateId: template.id,
                trigger: parsed.data.trigger,
                customerId: customer.id,
                subscriptionId: subscription?.id ?? null,
                paymentId: effectivePayment?.id ?? null
            }, "job:subscriptionReminder").catch((err) => {
                logger_1.logger.warn({ err, customerId: customer.id, paymentId: effectivePayment?.id ?? null }, "subscriptionReminder: fallo escribiendo systemLog de mensaje duplicado");
            });
            return { ok: false, skipped: true, error: "duplicate" };
        }
    }
    const resolvedTenantId = subscription?.tenantId ?? customer.tenantId ?? effectivePayment?.tenantId ?? (await (0, tenantContext_1.getDefaultTenantId)());
    if (!resolvedTenantId)
        throw new Error("tenant_required");
    const created = await prisma_1.prisma.chatwootMessage.create({
        data: {
            tenantId: resolvedTenantId,
            customerId: customer.id,
            subscriptionId: subscription?.id ?? effectivePayment?.subscriptionId ?? null,
            paymentId: effectivePayment?.id ?? null,
            type: template.chatwootType,
            status: client_1.MessageStatus.PENDING,
            to: customer.phone ?? null,
            content: auditableContent,
            actor: "Sistema",
            providerResp: normalizedRenderedTemplateParams
                ? {
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
                }
                : null
        }
    });
    if (parsed?.data?.trigger === "PAYMENT_DECLINED" && subscription) {
        // Optional: mark past-due for visibility (best-effort).
        if (subscription.status !== client_1.SubscriptionStatus.CANCELED && subscription.status !== client_1.SubscriptionStatus.EXPIRED) {
            await prisma_1.prisma.subscription.update({
                where: { id: subscription.id },
                data: { status: client_1.SubscriptionStatus.PAST_DUE }
            }).catch((err) => {
                logger_1.logger.warn({ err, subscriptionId: subscription.id }, "subscriptionReminder: fallo marcando suscripción en PAST_DUE");
            });
        }
    }
    if (parsed.data.immediateSend) {
        try {
            await (0, sendChatwootMessage_1.sendChatwootMessage)(created.id);
            const refreshed = await prisma_1.prisma.chatwootMessage.findUnique({
                where: { id: created.id },
                select: { status: true, errorMessage: true }
            });
            if (refreshed?.status !== client_1.MessageStatus.SENT) {
                const errorMessage = String(refreshed?.errorMessage || "chatwoot_send_failed");
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Mensaje fallido", {
                    trigger: parsed.data.trigger,
                    ruleId: parsed.data.ruleId,
                    chatwootMessageId: created.id,
                    customerId: customer.id,
                    paymentId: effectivePayment?.id ?? null,
                    err: errorMessage
                }, "job:subscriptionReminder").catch((err) => {
                    logger_1.logger.warn({ err, chatwootMessageId: created.id }, "subscriptionReminder: fallo escribiendo systemLog de mensaje fallido");
                });
                return { ok: false, error: errorMessage };
            }
        }
        catch (err) {
            const errorMessage = err?.message ? String(err.message) : "unknown_error";
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.dispatch", "Mensaje fallido", {
                trigger: parsed.data.trigger,
                ruleId: parsed.data.ruleId,
                chatwootMessageId: created.id,
                customerId: customer.id,
                paymentId: effectivePayment?.id ?? null,
                err: errorMessage
            }, "job:subscriptionReminder").catch((logErr) => {
                logger_1.logger.warn({ err: logErr, chatwootMessageId: created.id }, "subscriptionReminder: fallo escribiendo systemLog de excepción en envío");
            });
            return { ok: false, error: errorMessage };
        }
        return { ok: true, sent: true };
    }
    else {
        await prisma_1.prisma.retryJob.create({
            data: {
                type: client_1.RetryJobType.SEND_CHATWOOT_MESSAGE,
                payload: { chatwootMessageId: created.id }
            }
        });
        return { ok: true, queued: true };
    }
}
