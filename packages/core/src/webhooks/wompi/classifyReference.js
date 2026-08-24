"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isShopifyReference = isShopifyReference;
exports.isShopifyLikePayment = isShopifyLikePayment;
exports.classifyReference = classifyReference;
exports.isShopifyLikePayload = isShopifyLikePayload;
function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}
function isShopifySignal(value) {
    return normalizeText(value).toLowerCase().includes("shopify");
}
function isShopifyReference(reference) {
    return classifyReference(reference).kind === "shopify";
}
function isShopifyLikePayment(args) {
    const reference = normalizeText(args.reference);
    if (reference && isShopifyReference(reference))
        return true;
    if ([args.origin, args.source, args.provider].some(isShopifySignal))
        return true;
    const redirectUrl = normalizeText(args.redirectUrl).toLowerCase();
    if (!redirectUrl)
        return false;
    return redirectUrl.includes("shopify") || redirectUrl.includes("/continue-checkout/");
}
function classifyReference(reference) {
    const ref = (reference ?? "").trim();
    if (!ref)
        return { kind: "unknown", reference: "" };
    if (ref.startsWith("SUB_")) {
        // Format: SUB_<subscriptionId>_<cycle?>
        const parts = ref.split("_");
        const subscriptionId = parts[1] ?? "";
        const cycle = parts[2] ? Number(parts[2]) : undefined;
        return { kind: "subscription", subscriptionId, cycle: Number.isFinite(cycle) ? cycle : undefined };
    }
    if (ref.startsWith("ORDER_")) {
        // Format: ORDER_<externalRef>_<planId?>
        const parts = ref.split("_");
        const externalRef = parts[1] ?? "";
        const planId = parts[2] ?? undefined;
        const externalRefUpper = String(externalRef || "").toUpperCase();
        if (externalRefUpper.includes("SHOPIFY")) {
            return { kind: "shopify", reference: ref };
        }
        return { kind: "order", reference: externalRef, planId: (planId && planId.length > 20) ? planId : undefined };
    }
    if (ref.startsWith("SHOPIFY_")) {
        return { kind: "shopify", reference: ref };
    }
    return { kind: "unknown", reference: ref };
}
function isShopifyLikePayload(raw) {
    if (!raw || typeof raw !== "object")
        return false;
    const root = raw;
    const data = root.data && typeof root.data === "object" ? root.data : null;
    const tx = data?.transaction && typeof data.transaction === "object"
        ? data.transaction
        : root.transaction && typeof root.transaction === "object"
            ? root.transaction
            : null;
    const reconciliation = root.reconciliation && typeof root.reconciliation === "object"
        ? root.reconciliation
        : null;
    return isShopifyLikePayment({
        reference: normalizeText(tx?.reference) ||
            normalizeText(data?.reference) ||
            normalizeText(root.reference),
        origin: normalizeText(tx?.origin) ||
            normalizeText(data?.origin) ||
            normalizeText(reconciliation?.origin) ||
            normalizeText(root.origin),
        redirectUrl: normalizeText(tx?.redirect_url) ||
            normalizeText(tx?.redirectUrl) ||
            normalizeText(data?.redirect_url) ||
            normalizeText(root.redirect_url) ||
            normalizeText(root.redirectUrl),
        source: normalizeText(reconciliation?.source) ||
            normalizeText(root.source),
        provider: normalizeText(reconciliation?.provider) ||
            normalizeText(root.provider)
    });
}
