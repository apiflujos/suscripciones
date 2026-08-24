"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSubscriptionCollectionMode = resolveSubscriptionCollectionMode;
function normalizeMode(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (raw === "AUTO_DEBIT")
        return "AUTO_DEBIT";
    if (raw === "AUTO_LINK")
        return "AUTO_LINK";
    return "MANUAL_LINK";
}
function resolveSubscriptionCollectionMode(input) {
    const meta = (input?.metadata && typeof input.metadata === "object" ? input.metadata : {});
    const planMeta = (input?.plan?.metadata && typeof input.plan.metadata === "object"
        ? input.plan.metadata
        : {});
    // 1) Freeze at subscription-level (preferred source of truth).
    const fromSubscription = meta?.collectionMode ?? meta?.billing?.collectionMode;
    if (fromSubscription != null)
        return normalizeMode(fromSubscription);
    // 2) Fallback to current plan metadata for legacy records.
    const fromPlan = planMeta?.collectionMode;
    return normalizeMode(fromPlan);
}
