export type SubscriptionCollectionMode = "AUTO_DEBIT" | "AUTO_LINK" | "MANUAL_LINK";

function normalizeMode(value: unknown): SubscriptionCollectionMode {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "AUTO_DEBIT") return "AUTO_DEBIT";
  if (raw === "AUTO_LINK") return "AUTO_LINK";
  return "MANUAL_LINK";
}

export function resolveSubscriptionCollectionMode(input: {
  metadata?: unknown;
  plan?: { metadata?: unknown } | null;
}): SubscriptionCollectionMode {
  const meta = (input?.metadata && typeof input.metadata === "object" ? input.metadata : {}) as Record<string, any>;
  const planMeta = (input?.plan?.metadata && typeof input.plan.metadata === "object"
    ? input.plan.metadata
    : {}) as Record<string, any>;

  // 1) Freeze at subscription-level (preferred source of truth).
  const fromSubscription = meta?.collectionMode ?? meta?.billing?.collectionMode;
  if (fromSubscription != null) return normalizeMode(fromSubscription);

  // 2) Fallback to current plan metadata for legacy records.
  const fromPlan = planMeta?.collectionMode;
  return normalizeMode(fromPlan);
}

