import { createPaymentLinkForSubscription } from "../../services/subscriptionBilling";

export async function paymentRetry(payload: any) {
  const subscriptionId = String(payload?.subscriptionId || "").trim();
  if (!subscriptionId) return;
  await createPaymentLinkForSubscription({ subscriptionId });
}

