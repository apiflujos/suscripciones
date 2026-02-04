import { ChatwootMessageType, LogLevel, PaymentStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { systemLog } from "./systemLog";
import { getChatwootConfig, getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiRedirectUrl } from "./runtimeConfig";

export async function createPaymentLinkForSubscription(args: {
  subscriptionId: string;
  amountInCentsOverride?: number;
}): Promise<{ paymentId: string; wompiPaymentLinkId: string; checkoutUrl: string }> {
  const sub = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { plan: true, customer: true }
  });
  if (!sub) throw new Error("subscription_not_found");
  if (sub.status === SubscriptionStatus.CANCELED) throw new Error("subscription_canceled");

  const cycle = sub.currentCycle;
  const reference = `SUB_${sub.id}_${cycle}`;
  const amountInCents = args.amountInCentsOverride ?? sub.plan.priceInCents;

  const subscriptionCycleKey = `${sub.id}:${cycle}`;
  const payment = await prisma.payment.upsert({
    where: { subscriptionCycleKey },
    create: {
      customerId: sub.customerId,
      subscriptionId: sub.id,
      amountInCents,
      currency: sub.plan.currency,
      cycleNumber: cycle,
      reference,
      status: PaymentStatus.PENDING,
      subscriptionCycleKey
    },
    update: {
      amountInCents,
      currency: sub.plan.currency,
      reference,
      status: PaymentStatus.PENDING
    }
  });

  if (payment.checkoutUrl && payment.wompiPaymentLinkId) {
    return {
      paymentId: payment.id,
      wompiPaymentLinkId: payment.wompiPaymentLinkId,
      checkoutUrl: payment.checkoutUrl
    };
  }

  const privateKey = await getWompiPrivateKey();
  if (!privateKey) throw new Error("wompi_private_key_not_configured");

  const wompi = new WompiClient({
    apiBaseUrl: await getWompiApiBaseUrl(),
    privateKey,
    checkoutLinkBaseUrl: await getWompiCheckoutLinkBaseUrl()
  });

  let created: Awaited<ReturnType<WompiClient["createPaymentLink"]>>;
  try {
    const redirectUrl = await getWompiRedirectUrl();
    created = await wompi.createPaymentLink({
      name: `Suscripción ${sub.plan.name}`,
      description: `Suscripción ${sub.id} (ciclo ${cycle})`,
      single_use: true,
      collect_shipping: false,
      currency: sub.plan.currency,
      amount_in_cents: amountInCents,
      redirect_url: redirectUrl,
      sku: payment.id
    });
  } catch (err: any) {
    await prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNo: 0,
        status: "PAYMENT_LINK_CREATE_FAILED",
        provider: "wompi",
        errorMessage: err?.message ? String(err.message) : "unknown error"
      }
    });
    await systemLog(LogLevel.ERROR, "subscriptions.payment_link", "Payment link create failed", {
      subscriptionId: sub.id,
      paymentId: payment.id,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    throw err;
  }

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      attemptNo: 0,
      status: "PAYMENT_LINK_CREATED",
      provider: "wompi",
      response: created.raw as any
    }
  });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      wompiPaymentLinkId: created.id,
      checkoutUrl: created.checkoutUrl
    }
  });

  await systemLog(LogLevel.INFO, "subscriptions.payment_link", "Payment link created", {
    subscriptionId: sub.id,
    paymentId: updated.id,
    wompiPaymentLinkId: created.id
  }).catch(() => {});

  const chatwoot = await getChatwootConfig();
  if (chatwoot.configured) {
    const recentlySent = await prisma.chatwootMessage.findFirst({
      where: {
        paymentId: updated.id,
        type: ChatwootMessageType.PAYMENT_LINK,
        status: "SENT",
        createdAt: { gt: new Date(Date.now() - 10 * 60_000) }
      }
    });

    if (!recentlySent) {
      const msg = await prisma.chatwootMessage.create({
        data: {
          customerId: sub.customerId,
          subscriptionId: sub.id,
          paymentId: updated.id,
          type: ChatwootMessageType.PAYMENT_LINK,
          content: `Link de pago (ciclo ${cycle}): ${updated.checkoutUrl}`
        }
      });
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.SEND_CHATWOOT_MESSAGE,
          payload: { chatwootMessageId: msg.id }
        }
      });
    }
  }

  if (!updated.checkoutUrl) throw new Error("checkout_url_missing");
  return { paymentId: updated.id, wompiPaymentLinkId: created.id, checkoutUrl: updated.checkoutUrl };
}
