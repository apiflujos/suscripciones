"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationsConfigSchema = exports.notificationChannelSchema = exports.notificationTriggerSchema = void 0;
exports.getNotificationsConfig = getNotificationsConfig;
exports.getNotificationsActiveEnv = getNotificationsActiveEnv;
exports.getNotificationsConfigForEnv = getNotificationsConfigForEnv;
exports.resolveNotificationRule = resolveNotificationRule;
exports.resolveNotificationTemplate = resolveNotificationTemplate;
exports.filterNotificationRules = filterNotificationRules;
exports.setNotificationsConfig = setNotificationsConfig;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const chatwootTemplates_1 = require("./chatwootTemplates");
const credentials_1 = require("./credentials");
function normalizeActiveEnv(value) {
    const v = String(value || "")
        .trim()
        .toUpperCase();
    return v === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
}
async function getCommsActiveEnv() {
    const fromDb = await (0, credentials_1.getCredential)(client_1.CredentialProvider.CHATWOOT, "ACTIVE_ENV");
    if (fromDb)
        return normalizeActiveEnv(fromDb);
    return normalizeActiveEnv(process.env.CHATWOOT_ACTIVE_ENV);
}
exports.notificationTriggerSchema = zod_1.z.enum([
    "SUBSCRIPTION_DUE",
    "PAYMENT_LINK_CREATED",
    "PAYMENT_APPROVED",
    "PAYMENT_DECLINED",
    "CATALOG_LINK_CREATED",
    "TOKENIZATION_LINK_CREATED"
]);
exports.notificationChannelSchema = zod_1.z.enum(["CHATWOOT", "META"]);
const paymentStatusSchema = zod_1.z.enum(["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"]);
const paymentTypeSchema = zod_1.z.enum(["PLAN", "SUBSCRIPTION", "LINK"]);
const subscriptionStatusSchema = zod_1.z.enum(["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"]);
const chatwootMessageTypeSchema = zod_1.z.enum(["PAYMENT_LINK", "PAYMENT_CONFIRMED", "EXPIRY_WARNING", "PAYMENT_FAILED"]);
const chatwootTemplateParamsSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    category: zod_1.z.string().min(1).optional(),
    language: zod_1.z.string().min(1),
    processed_params: zod_1.z.any().optional()
});
const templateSchema = zod_1.z
    .object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    channel: exports.notificationChannelSchema,
    chatwootType: chatwootMessageTypeSchema.optional(),
    content: zod_1.z.string().min(1).optional(),
    chatwootTemplate: chatwootTemplateParamsSchema.optional(),
    meta: zod_1.z
        .object({
        templateName: zod_1.z.string().min(1),
        language: zod_1.z.string().min(1),
        components: zod_1.z.any().optional()
    })
        .optional()
})
    .superRefine((val, ctx) => {
    if (val.channel === "CHATWOOT") {
        if (!val.chatwootType)
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: "chatwootType requerido", path: ["chatwootType"] });
        if (!val.content && !val.chatwootTemplate)
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: "content o chatwootTemplate requerido", path: ["content"] });
        return;
    }
    if (!val.meta)
        ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: "meta requerido", path: ["meta"] });
});
const ruleSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    enabled: zod_1.z.boolean().default(true),
    trigger: exports.notificationTriggerSchema,
    templateId: zod_1.z.string().min(1),
    offsetsSeconds: zod_1.z.array(zod_1.z.number().int()).optional(),
    offsetsMinutes: zod_1.z.array(zod_1.z.number().int()).optional(),
    atTimeBogota: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    atTimeUtc: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), // deprecated alias — use atTimeBogota
    ensurePaymentLink: zod_1.z.boolean().optional(),
    conditions: zod_1.z
        .object({
        skipIfSubscriptionStatusIn: zod_1.z.array(subscriptionStatusSchema).optional(),
        skipIfPaymentStatusIn: zod_1.z.array(paymentStatusSchema).optional(),
        requirePaymentStatusIn: zod_1.z.array(paymentStatusSchema).optional(),
        requirePaymentTypeIn: zod_1.z.array(paymentTypeSchema).optional()
    })
        .optional()
});
exports.notificationsConfigSchema = zod_1.z.object({
    version: zod_1.z.number().int().default(1),
    templates: zod_1.z.array(templateSchema).default([]),
    rules: zod_1.z.array(ruleSchema).default([])
});
function defaultConfig() {
    return {
        version: 1,
        templates: [],
        rules: []
    };
}
const CANONICAL_TEMPLATE_NAMES = {
    tpl_rt_catalog_link_created_plan: "Checkout de catálogo enviado",
    tpl_rt_catalog_link_created_subscription: "Checkout de catálogo enviado (suscripción)",
    tpl_rt_tokenization_link_created: "Link de tokenización enviado (débito automático)",
    tpl_rt_payment_link_created: "Link de cobro enviado (link de pago)",
    tpl_rt_payment_link_created_subscription: "Link de cobro enviado (suscripción · link de pago)",
    tpl_rt_payment_success: "Pago aprobado",
    tpl_rt_payment_failed_link: "Pago rechazado (link de pago)",
    tpl_rt_payment_failed_subscription: "Pago rechazado (débito automático)",
    tpl_reminder_due_link: "Recordatorio antes del vencimiento (link de pago)",
    tpl_reminder_due_subscription: "Recordatorio antes del vencimiento (débito automático)",
    tpl_reminder_mora_link: "Recordatorio en mora (link de pago)",
    tpl_reminder_mora_subscription: "Recordatorio en mora (débito automático)"
};
const CANONICAL_RULE_NAMES = {
    rule_rt_catalog_link_created_plan: "Checkout de catálogo enviado",
    rule_rt_catalog_link_created_subscription: "Checkout de catálogo enviado (suscripción)",
    rule_rt_tokenization_link_created: "Link de tokenización enviado (débito automático)",
    rule_rt_payment_link_created: "Link de cobro enviado (link de pago)",
    rule_rt_payment_link_created_subscription: "Link de cobro enviado (suscripción · link de pago)",
    rule_rt_payment_success: "Pago aprobado",
    rule_rt_payment_failed_link: "Pago rechazado (link de pago)",
    rule_rt_payment_failed_subscription: "Pago rechazado (débito automático)",
    rule_reminder_due_link: "Recordatorio antes del vencimiento (link de pago)",
    rule_reminder_due_subscription: "Recordatorio antes del vencimiento (débito automático)",
    rule_reminder_mora_link: "Recordatorio en mora (link de pago)",
    rule_reminder_mora_subscription: "Recordatorio en mora (débito automático)"
};
function keyForEnv(env) {
    return `NOTIFICATIONS_CONFIG_${env}`;
}
async function getNotificationsConfig() {
    const env = await getCommsActiveEnv();
    return getNotificationsConfigForEnv(env);
}
async function getNotificationsActiveEnv() {
    return getCommsActiveEnv();
}
async function getNotificationsConfigForEnv(env) {
    const raw = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.CHATWOOT, keyForEnv(env))) ||
        (await (0, credentials_1.getCredential)(client_1.CredentialProvider.CHATWOOT, "NOTIFICATIONS_CONFIG")) ||
        (process.env.NOTIFICATIONS_CONFIG_JSON || "").trim();
    if (!raw)
        return defaultConfig();
    try {
        const parsed = JSON.parse(raw);
        const cfg = exports.notificationsConfigSchema.parse(parsed);
        return normalizeNotificationsConfig(cfg);
    }
    catch {
        return defaultConfig();
    }
}
function hasTokenizationKeyword(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized)
        return false;
    return (normalized.includes("tokeniz") ||
        normalized.includes("tokenizaci") ||
        normalized.includes("tokenization") ||
        normalized.includes("debito") ||
        normalized.includes("débito"));
}
function isLegacyTokenizationRule(args) {
    const rule = args.rule;
    const template = args.template;
    const ruleHints = [
        rule.id,
        rule.name
    ];
    const templateHints = template
        ? [
            template.id,
            template.name,
            template.chatwootTemplate?.name
        ]
        : [];
    return [...ruleHints, ...templateHints].some((value) => hasTokenizationKeyword(value));
}
function hasUsableWhatsAppTemplate(template) {
    if (!template)
        return false;
    if (String(template.channel || "").toUpperCase() !== "CHATWOOT")
        return false;
    return Boolean(String(template.chatwootTemplate?.name || "").trim());
}
function resolveNotificationRule(args) {
    const rules = Array.isArray(args.rules) ? args.rules : [];
    const candidates = rules.filter((rule) => rule.enabled && rule.trigger === args.trigger);
    if (!candidates.length)
        return null;
    if (args.paymentType) {
        const paymentType = args.paymentType;
        const exact = candidates.find((rule) => {
            const types = rule.conditions?.requirePaymentTypeIn || [];
            return types.includes(paymentType);
        }) || null;
        if (exact)
            return exact;
    }
    return (candidates.find((rule) => {
        const types = rule.conditions?.requirePaymentTypeIn || [];
        return types.length === 0;
    }) || null);
}
function resolveNotificationTemplate(args) {
    const rule = resolveNotificationRule({
        rules: args.rules,
        trigger: args.trigger,
        paymentType: args.paymentType
    });
    if (!rule)
        return null;
    const templates = Array.isArray(args.templates) ? args.templates : [];
    return templates.find((template) => String(template.id) === String(rule.templateId)) || null;
}
function filterNotificationRules(args) {
    const rules = Array.isArray(args.rules) ? args.rules : [];
    const normalized = String(args.paymentType || "").trim().toUpperCase();
    return rules.filter((rule) => {
        if (!rule.enabled || rule.trigger !== args.trigger)
            return false;
        const required = rule.conditions?.requirePaymentTypeIn || [];
        if (!required.length)
            return true;
        if (!normalized)
            return false;
        return required.includes(normalized);
    });
}
function normalizeNotificationsConfig(cfg) {
    const templates = Array.isArray(cfg.templates) ? cfg.templates : [];
    const validTemplates = templates
        .map((template) => {
        const canonicalName = CANONICAL_TEMPLATE_NAMES[String(template.id)];
        const normalizedTemplate = template?.chatwootTemplate
            ? {
                ...template,
                chatwootTemplate: {
                    ...template.chatwootTemplate,
                    processed_params: (0, chatwootTemplates_1.normalizeProcessedTemplateParams)(template.chatwootTemplate.processed_params, template?.meta?.components)
                }
            }
            : template;
        return canonicalName ? { ...normalizedTemplate, name: canonicalName } : normalizedTemplate;
    })
        .filter((t) => hasUsableWhatsAppTemplate(t));
    const templateById = new Map(validTemplates.map((t) => [String(t.id), t]));
    const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
    const nextRules = rules.map((rule) => {
        const canonicalName = CANONICAL_RULE_NAMES[String(rule.id)];
        const next = {
            ...rule,
            ...(canonicalName ? { name: canonicalName } : {}),
            conditions: rule.conditions ? { ...rule.conditions } : undefined
        };
        const ruleId = String(next.id || "").trim().toLowerCase();
        const ruleName = String(next.name || "").trim().toLowerCase();
        if (next.trigger === "PAYMENT_LINK_CREATED") {
            const tpl = templateById.get(String(next.templateId));
            if (isLegacyTokenizationRule({ rule: next, template: tpl })) {
                next.trigger = "TOKENIZATION_LINK_CREATED";
                if (next.conditions?.requirePaymentTypeIn)
                    delete next.conditions.requirePaymentTypeIn;
            }
            else if (ruleId.includes("subscription") || ruleName.includes("suscrip")) {
                next.conditions = { ...(next.conditions || {}), requirePaymentTypeIn: ["SUBSCRIPTION"] };
            }
            else if (!next.conditions?.requirePaymentTypeIn || next.conditions.requirePaymentTypeIn.length === 0) {
                next.conditions = { ...(next.conditions || {}), requirePaymentTypeIn: ["LINK"] };
            }
        }
        else if (next.trigger === "TOKENIZATION_LINK_CREATED") {
            if (next.conditions?.requirePaymentTypeIn)
                delete next.conditions.requirePaymentTypeIn;
        }
        return next;
    });
    const activeRuleIds = new Set(nextRules.map((r) => String(r.templateId)));
    const filteredTemplates = validTemplates.filter((t) => activeRuleIds.has(String(t.id)));
    const filteredTemplateIds = new Set(filteredTemplates.map((t) => String(t.id)));
    const filteredRules = nextRules.filter((r) => filteredTemplateIds.has(String(r.templateId)));
    return { ...cfg, templates: filteredTemplates, rules: filteredRules };
}
async function setNotificationsConfig(cfg, opts) {
    const env = opts?.environment || (await getCommsActiveEnv());
    const normalized = normalizeNotificationsConfig(exports.notificationsConfigSchema.parse(cfg));
    await (0, credentials_1.setCredential)(client_1.CredentialProvider.CHATWOOT, keyForEnv(env), JSON.stringify(normalized));
    return normalized;
}
