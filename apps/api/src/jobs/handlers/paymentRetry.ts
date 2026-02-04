import { prisma } from "../../db/prisma";
import { LogLevel } from "@prisma/client";
import { createAutoDebitTransactionForSubscription, createPaymentLinkForSubscription } from "../../services/subscriptionBilling";
import { systemLog } from "../../services/systemLog";

export async function paymentRetry(payload: any) {
  const subscriptionId = String(payload?.subscriptionId || "").trim();
  if (!subscriptionId) return;
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
  if (!sub) return;

  const mode = String((sub.plan.metadata as any)?.collectionMode || "MANUAL_LINK");
  if (mode === "AUTO_DEBIT") {
    try {
      await createAutoDebitTransactionForSubscription({ subscriptionId });
    } catch (err: any) {
      await systemLog(LogLevel.ERROR, "jobs.payment_retry", "Auto-debit charge failed; attempting emergency link", {
        subscriptionId,
        err: err?.message ? String(err.message) : "unknown error"
      }).catch(() => {});
      // Emergency fallback: generate a payment link so the user can pay manually.
      await createPaymentLinkForSubscription({ subscriptionId }).catch(() => {});
      throw err;
    }
    return;
  }

  await createPaymentLinkForSubscription({ subscriptionId });
}
