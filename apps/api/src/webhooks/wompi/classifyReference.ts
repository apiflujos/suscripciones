export type PaymentSource =
  | { kind: "subscription"; subscriptionId: string; cycle?: number }
  | { kind: "order"; reference: string; planId?: string }
  | { kind: "shopify"; reference: string }
  | { kind: "unknown"; reference: string };

export function classifyReference(reference: string | undefined | null): PaymentSource {
  const ref = (reference ?? "").trim();
  if (!ref) return { kind: "unknown", reference: "" };

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
    return { kind: "order", reference: externalRef, planId: (planId && planId.length > 20) ? planId : undefined };
  }

  if (ref.startsWith("SHOPIFY_")) {
    return { kind: "shopify", reference: ref };
  }

  return { kind: "unknown", reference: ref };
}

