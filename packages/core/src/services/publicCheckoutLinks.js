"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPublicCheckoutLink = createPublicCheckoutLink;
exports.persistPublicPaymentLinkForPayment = persistPublicPaymentLinkForPayment;
const client_1 = require("@prisma/client");
const prisma_1 = require("../db/prisma");
const credentials_1 = require("./credentials");
const publicBase_1 = require("./publicBase");
const publicTokens_1 = require("./publicTokens");
const customerMetadata_1 = require("../lib/customerMetadata");
const checkoutConfig_1 = require("./checkoutConfig");
function ensureHttps(value) {
    if (!value)
        return value;
    if (/^https?:\/\//i.test(value))
        return value;
    return `https://${value.replace(/^\/+/, "")}`;
}
function normalizeBase(base, kind) {
    const normalized = ensureHttps(base).replace(/\/$/, "");
    const planPath = /\/public\/plan$/i;
    const subPath = /\/public\/suscripcion$/i;
    const cartPath = /\/public\/cart$/i;
    if (kind === "SUBSCRIPTION") {
        return subPath.test(normalized) ? normalized : `${normalized}/public/suscripcion`;
    }
    if (kind === "CART") {
        return cartPath.test(normalized) ? normalized : `${normalized}/public/cart`;
    }
    return planPath.test(normalized) ? normalized : `${normalized}/public/plan`;
}
async function createPublicCheckoutLink(args) {
    const customerId = String(args.customerId || "").trim();
    const templateId = String(args.templateId || "").trim();
    if (!customerId || !templateId)
        return null;
    const template = await prisma_1.prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.active === false)
        return null;
    const rawCfg = await (0, credentials_1.getCredential)(client_1.CredentialProvider.WOMPI, "CHECKOUT_CONFIG");
    const cfg = (0, checkoutConfig_1.readCheckoutConfig)(rawCfg);
    const envBases = (0, publicBase_1.getCheckoutBaseUrlsFromEnv)();
    const planBase = String(cfg.planBaseUrl || "").trim() || envBases.planBaseUrl || "";
    const subscriptionBase = String(cfg.subscriptionBaseUrl || "").trim() || envBases.subscriptionBaseUrl || "";
    const cartBase = String(cfg.cartBaseUrl || "").trim() ||
        envBases.cartBaseUrl ||
        planBase ||
        subscriptionBase ||
        "";
    const base = template.kind === "SUBSCRIPTION"
        ? subscriptionBase
        : template.kind === "CART"
            ? cartBase
            : planBase;
    if (!base)
        return null;
    const expiryFromTemplate = Number(template.expiryHours || 0);
    const expiryFromCfg = Number(cfg.tokenExpiryHours || 0);
    const hours = Number.isFinite(expiryFromTemplate) && expiryFromTemplate > 0
        ? Math.min(Math.max(Math.trunc(expiryFromTemplate), 1), 168)
        : Number.isFinite(expiryFromCfg) && expiryFromCfg > 0
            ? Math.min(Math.max(Math.trunc(expiryFromCfg), 1), 168)
            : 24;
    const scope = template.kind === "SUBSCRIPTION" ? "tokenization" : template.kind === "CART" ? "cart" : "payment";
    const token = await (0, publicTokens_1.signPublicToken)({ sub: customerId, scope, ttlSeconds: hours * 60 * 60 });
    const baseUrl = normalizeBase(base, template.kind);
    const rawUrl = `${baseUrl}/${token}`;
    const utm = String(template.utmParams || cfg.defaultUtmParams || "").trim();
    const url = utm ? `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : rawUrl;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const customer = await prisma_1.prisma.customer.findUnique({
        where: { id: customerId },
        select: { metadata: true }
    });
    if (!customer)
        return null;
    const prevMeta = (0, customerMetadata_1.readCustomerMetadata)(customer.metadata);
    const commonLink = {
        token,
        url,
        templateId: template.id,
        kind: template.kind,
        createdAt: new Date().toISOString(),
        expiresAt,
        usedAt: null,
        utmParams: utm || null
    };
    const nextMeta = template.kind === "SUBSCRIPTION"
        ? {
            ...prevMeta,
            tokenizationLink: {
                ...(prevMeta?.tokenizationLink || {}),
                ...commonLink,
                returnUrl: (0, publicBase_1.getSafePublicReturnUrl)(String(cfg.tokenizationReturnUrl || "").trim()) || (0, publicBase_1.getSafePublicReturnUrl)(String(prevMeta?.tokenizationLink?.returnUrl || "").trim()) || null,
                tenantId: template.tenantId || null,
                planId: args.planId ?? null,
                productId: args.productId ?? null
            }
        }
        : template.kind === "CART"
            ? {
                ...prevMeta,
                cartLink: {
                    ...(prevMeta?.cartLink || {}),
                    ...commonLink,
                    tenantId: template.tenantId || null
                }
            }
            : {
                ...prevMeta,
                paymentLink: {
                    ...(prevMeta?.paymentLink || {}),
                    ...commonLink,
                    tenantId: template.tenantId || null,
                    checkoutUrl: (0, publicBase_1.normalizePublicUrl)(args.checkoutUrl) ||
                        (0, publicBase_1.normalizePublicUrl)(prevMeta?.paymentLink?.checkoutUrl) ||
                        null,
                    templateName: template.name
                }
            };
    await prisma_1.prisma.customer.update({
        where: { id: customerId },
        data: { metadata: nextMeta }
    });
    return {
        url,
        token,
        templateId: template.id,
        templateName: template.name,
        kind: template.kind,
        expiresAt,
        utmParams: utm || null
    };
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
async function persistPublicPaymentLinkForPayment(args) {
    const paymentId = String(args.paymentId || "").trim();
    const url = (0, publicBase_1.normalizePublicUrl)(args.publicCheckout?.url);
    const token = String(args.publicCheckout?.token || "").trim();
    if (!paymentId || !url || !token)
        return null;
    const payment = await prisma_1.prisma.payment.findUnique({
        where: { id: paymentId },
        select: { providerResponse: true, checkoutUrl: true, amountInCents: true, currency: true }
    });
    if (!payment)
        return null;
    return prisma_1.prisma.payment.update({
        where: { id: paymentId },
        data: {
            providerResponse: {
                ...asRecord(payment.providerResponse),
                publicPaymentLink: {
                    token,
                    url,
                    kind: args.publicCheckout.kind || client_1.PublicCheckoutKind.PLAN,
                    checkoutUrl: (0, publicBase_1.normalizePublicUrl)(args.checkoutUrl) || (0, publicBase_1.normalizePublicUrl)(payment.checkoutUrl) || null,
                    templateId: String(args.publicCheckout.templateId || "").trim() || null,
                    templateName: String(args.publicCheckout.templateName || "").trim() || null,
                    productId: String(args.productId || "").trim() || null,
                    amountInCents: Number.isFinite(Number(args.amountInCents)) ? Number(args.amountInCents) : payment.amountInCents,
                    currency: String(args.currency || payment.currency || "COP"),
                    createdAt: new Date().toISOString(),
                    expiresAt: args.publicCheckout.expiresAt || null,
                    utmParams: args.publicCheckout.utmParams || null
                }
            }
        }
    });
}
