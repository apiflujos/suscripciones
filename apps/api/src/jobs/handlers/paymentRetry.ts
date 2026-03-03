import { prisma } from "../../db/prisma";
import { LogLevel } from "@prisma/client";
import { createAutoDebitTransactionForSubscription, createPaymentLinkForSubscription } from "../../services/subscriptionBilling";
import { systemLog } from "../../services/systemLog";

function isAutoDebitDisabled() {
  const raw = String(process.env.AUTO_DEBIT_DISABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function shouldCreateFallbackLinkWhenAutoDebitDisabled() {
  const raw = String(process.env.AUTO_DEBIT_DISABLED_FALLBACK_LINK || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export async function paymentRetry(payload: any) {
  const subscriptionId = String(payload?.subscriptionId || "").trim();
  if (!subscriptionId) return;
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
  if (!sub) return;

  const mode = String((sub.plan.metadata as any)?.collectionMode || "MANUAL_LINK");
  if (mode === "AUTO_DEBIT") {
    if (isAutoDebitDisabled()) {
      await systemLog(LogLevel.WARN, "jobs.payment_retry", "Auto-debit automático deshabilitado; cobro omitido", {
        subscriptionId,
        env: "AUTO_DEBIT_DISABLED"
      }).catch(() => {});
      if (shouldCreateFallbackLinkWhenAutoDebitDisabled()) {
        await createPaymentLinkForSubscription({ subscriptionId }).catch(() => {});
      }
      return;
    }
    try {
      await createAutoDebitTransactionForSubscription({ subscriptionId });
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : "unknown error";
      const isMissingSource = msg === "customer_payment_source_missing";
      await systemLog(
        isMissingSource ? LogLevel.WARN : LogLevel.ERROR,
        "jobs.payment_retry",
        isMissingSource ? "Auto-debit sin token; creando link manual" : "Auto-debit charge failed; attempting emergency link",
        { subscriptionId, err: msg }
      ).catch(() => {});
      // Emergency fallback: generate a payment link so the user can pay manually.
      await createPaymentLinkForSubscription({ subscriptionId }).catch(() => {});
      if (!isMissingSource) throw err;
    }
    return;
  }

  await createPaymentLinkForSubscription({ subscriptionId });
}
