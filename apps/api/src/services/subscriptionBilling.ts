import { LogLevel, PaymentStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { systemLog } from "./systemLog";
import { sha256Hex } from "../lib/crypto";
import { ensureChatwootContactForCustomer, syncChatwootAttributesForCustomer } from "./chatwootSync";
import {
  getChatwootConfig,
  getWompiApiBaseUrl,
  getWompiCheckoutLinkBaseUrl,
  getWompiIntegritySecret,
  getWompiPrivateKey,
  getWompiPublicKey,
  getWompiRedirectUrl
} from "./runtimeConfig";
import { schedulePaymentLinkNotifications } from "./notificationsScheduler";

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
  if (sub.status === SubscriptionStatus.SUSPENDED) throw new Error("subscription_suspended");
  if (sub.status === SubscriptionStatus.EXPIRED) throw new Error("subscription_expired");

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
    await prisma.paymentLink
      .upsert({
        where: { paymentId: payment.id },
        create: {
          planId: sub.planId,
          subscriptionId: sub.id,
          paymentId: payment.id,
          wompiPaymentLinkId: payment.wompiPaymentLinkId,
          checkoutUrl: payment.checkoutUrl,
          status: payment.status === PaymentStatus.APPROVED ? "PAID" : "SENT",
          sentAt: new Date(),
          paidAt: payment.paidAt ?? null
        },
        update: {
          planId: sub.planId,
          subscriptionId: sub.id,
          wompiPaymentLinkId: payment.wompiPaymentLinkId,
          checkoutUrl: payment.checkoutUrl,
          paidAt: payment.paidAt ?? null,
          status: payment.status === PaymentStatus.APPROVED ? "PAID" : undefined
        }
      })
      .catch(() => {});
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

  await prisma.paymentLink
    .upsert({
      where: { paymentId: updated.id },
      create: {
        planId: sub.planId,
        subscriptionId: sub.id,
        paymentId: updated.id,
        wompiPaymentLinkId: created.id,
        checkoutUrl: updated.checkoutUrl || created.checkoutUrl,
        status: "SENT",
        sentAt: new Date()
      },
      update: {
        planId: sub.planId,
        subscriptionId: sub.id,
        wompiPaymentLinkId: created.id,
        checkoutUrl: updated.checkoutUrl || created.checkoutUrl
      }
    })
    .catch(() => {});

  await systemLog(LogLevel.INFO, "subscriptions.payment_link", "Payment link created", {
    subscriptionId: sub.id,
    paymentId: updated.id,
    wompiPaymentLinkId: created.id
  }).catch(() => {});

  await schedulePaymentLinkNotifications({ paymentId: updated.id }).catch(() => {});

  const chatwoot = await getChatwootConfig();
  if (chatwoot.configured) {
    await ensureChatwootContactForCustomer(sub.customerId).catch(() => {});
    await syncChatwootAttributesForCustomer(sub.customerId).catch(() => {});
  }

  if (!updated.checkoutUrl) throw new Error("checkout_url_missing");
  return { paymentId: updated.id, wompiPaymentLinkId: created.id, checkoutUrl: updated.checkoutUrl };
}

export async function createAutoDebitTransactionForSubscription(args: {
  subscriptionId: string;
  amountInCentsOverride?: number;
}): Promise<{ paymentId: string; wompiTransactionId: string }> {
  const sub = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { plan: true, customer: true }
  });
  if (!sub) throw new Error("subscription_not_found");
  if (sub.status === SubscriptionStatus.CANCELED) throw new Error("subscription_canceled");
  if (sub.status === SubscriptionStatus.SUSPENDED) throw new Error("subscription_suspended");
  if (sub.status === SubscriptionStatus.EXPIRED) throw new Error("subscription_expired");

  const paymentSourceId = (() => {
    const meta = (sub.customer.metadata as any) ?? {};
    const candidates = [
      meta?.wompi?.paymentSourceId,
      meta?.wompi?.payment_source_id,
      meta?.paymentSourceId,
      meta?.payment_source_id
    ];
    for (const v of candidates) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    }
    return null;
  })();
  if (!Number.isFinite(paymentSourceId as any)) throw new Error("customer_payment_source_missing");
  if (!sub.customer.email) throw new Error("customer_email_required");

  const cycle = sub.currentCycle;
  const reference = `SUB_${sub.id}_${cycle}`;
  const amountInCents = args.amountInCentsOverride ?? sub.plan.priceInCents;
  const currency = sub.plan.currency;

  const subscriptionCycleKey = `${sub.id}:${cycle}`;
  const payment = await prisma.payment.upsert({
    where: { subscriptionCycleKey },
    create: {
      customerId: sub.customerId,
      subscriptionId: sub.id,
      amountInCents,
      currency,
      cycleNumber: cycle,
      reference,
      status: PaymentStatus.PENDING,
      subscriptionCycleKey
    },
    update: { amountInCents, currency, reference, status: PaymentStatus.PENDING }
  });

  if (payment.wompiTransactionId) {
    return { paymentId: payment.id, wompiTransactionId: payment.wompiTransactionId };
  }

  const privateKey = await getWompiPrivateKey();
  if (!privateKey) throw new Error("wompi_private_key_not_configured");
  const integritySecret = await getWompiIntegritySecret();
  if (!integritySecret) throw new Error("wompi_integrity_secret_not_configured");
  const publicKey = await getWompiPublicKey();
  if (!publicKey) throw new Error("wompi_public_key_not_configured");

  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey, checkoutLinkBaseUrl });
  const merchant = await wompi.getMerchant(publicKey);

  const signature = sha256Hex(`${reference}${amountInCents}${currency}${integritySecret}`);
  let created: Awaited<ReturnType<WompiClient["createTransaction"]>>;
  try {
    created = await wompi.createTransaction({
      amount_in_cents: amountInCents,
      currency,
      customer_email: sub.customer.email,
      reference,
      signature,
      acceptance_token: merchant.acceptanceToken,
      accept_personal_auth: merchant.acceptPersonalAuth,
      payment_source_id: paymentSourceId as number,
      recurrent: true,
      payment_method: { installments: 1 }
    });
  } catch (err: any) {
    await prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNo: 0,
        status: "TRANSACTION_CREATE_FAILED",
        provider: "wompi",
        errorMessage: err?.message ? String(err.message) : "unknown error"
      }
    });
    await systemLog(LogLevel.ERROR, "subscriptions.auto_debit", "Transaction create failed", {
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
      status: "TRANSACTION_CREATED",
      provider: "wompi",
      response: created.raw as any
    }
  });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { wompiTransactionId: created.id, providerResponse: created.raw as any }
  });

  await systemLog(LogLevel.INFO, "subscriptions.auto_debit", "Transaction created", {
    subscriptionId: sub.id,
    paymentId: updated.id,
    wompiTransactionId: created.id
  }).catch(() => {});

  return { paymentId: updated.id, wompiTransactionId: created.id };
}
