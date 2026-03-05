import { CredentialProvider, LogLevel, PaymentLinkStatus, PaymentStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { systemLog } from "./systemLog";
import { syncChatwootAttributesForCustomer } from "./chatwootSync";
import { getCredential } from "./credentials";
import { logger } from "../lib/logger";
import { buildWompiTransactionSignature, validateWompiCurrency } from "../lib/wompiSignature";
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
import { resolveSubscriptionCollectionMode } from "./subscriptionMode";

const PAYMENT_LINK_LOCK_PREFIX = "payment-link";
const AUTO_DEBIT_LOCK_PREFIX = "auto-debit";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const logIgnored = (err: unknown, message: string, context?: Record<string, unknown>) => {
  logger.warn({ err, ...(context || {}) }, message);
};

type PlanMetadata = {
  collectionMode?: string;
};

type SubscriptionMetadata = {
  templateId?: string;
  pricing?: {
    totalInCents?: number;
    currency?: string;
  };
};

type CheckoutConfig = {
  planTitle?: string;
  planDescription?: string;
  subscriptionTitle?: string;
  subscriptionDescription?: string;
};

type CustomerWompiMeta = {
  paymentSourceId?: number | string;
  payment_source_id?: number | string;
};

type CustomerMetadata = {
  wompi?: CustomerWompiMeta;
  paymentSourceId?: number | string;
  payment_source_id?: number | string;
};

async function tryAcquirePaymentLinkLock(key: string) {
  const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtext(${key})) as locked
  `;
  return Boolean(rows?.[0]?.locked);
}

async function releasePaymentLinkLock(key: string) {
  await prisma.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${key}))
  `;
}

function formatCop(amountInCents: number) {
  const pesos = Math.trunc(Number(amountInCents || 0) / 100);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

function formatPeriodicity(intervalUnit: string, intervalCount: number) {
  const count = Number(intervalCount || 1);
  const unit = String(intervalUnit || "MONTH").toUpperCase();
  if (unit === "DAY") return count === 1 ? "diaria" : `cada ${count} días`;
  if (unit === "WEEK") return count === 1 ? "semanal" : `cada ${count} semanas`;
  if (unit === "MONTH") return count === 1 ? "mensual" : `cada ${count} meses`;
  return count === 1 ? "periódica" : `cada ${count} periodos`;
}

function replaceVars(input: string, vars: Record<string, string>) {
  return input
    .replaceAll("{contacto}", vars.contacto)
    .replaceAll("{producto}", vars.producto)
    .replaceAll("{monto}", vars.monto)
    .replaceAll("{periodicidad}", vars.periodicidad)
    .replaceAll("{fecha_expira}", vars.fecha_expira);
}

function readSubscriptionTotalInCents(subscriptionMeta: unknown): number | null {
  if (!subscriptionMeta || typeof subscriptionMeta !== "object") return null;
  const md = subscriptionMeta as any;
  const raw = md?.pricing?.totalInCents;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const total = Math.trunc(value);
  return total > 0 ? total : 0;
}

export async function createPaymentLinkForSubscription(args: {
  subscriptionId: string;
  amountInCentsOverride?: number;
}): Promise<{ paymentId: string; wompiPaymentLinkId: string; checkoutUrl: string }> {
  const sub = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { plan: true, customer: true }
  });
  if (!sub) throw new Error("subscription_not_found");
  const tenantId = sub.tenantId || sub.plan?.tenantId;
  if (!tenantId) throw new Error("tenant_required");
  if (sub.status === SubscriptionStatus.CANCELED) throw new Error("subscription_canceled");
  if (sub.status === SubscriptionStatus.SUSPENDED) throw new Error("subscription_suspended");
  if (sub.status === SubscriptionStatus.EXPIRED) throw new Error("subscription_expired");

  const cycle = sub.currentCycle;
  const reference = `SUB_${sub.id}_${cycle}`;
  const subscriptionTotal = readSubscriptionTotalInCents(sub.metadata);
  const amountInCents = args.amountInCentsOverride ?? subscriptionTotal ?? sub.plan.priceInCents;

  const subscriptionCycleKey = `${sub.id}:${cycle}`;
  const payment = await prisma.payment.upsert({
    where: { subscriptionCycleKey },
    create: {
      tenantId,
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
      tenantId,
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
          tenantId,
          planId: sub.planId,
          subscriptionId: sub.id,
          paymentId: payment.id,
          wompiPaymentLinkId: payment.wompiPaymentLinkId,
          checkoutUrl: payment.checkoutUrl,
          status: payment.status === PaymentStatus.APPROVED ? PaymentLinkStatus.PAID : PaymentLinkStatus.SENT,
          sentAt: new Date(),
          paidAt: payment.paidAt ?? null
        },
        update: {
          tenantId,
          planId: sub.planId,
          subscriptionId: sub.id,
          wompiPaymentLinkId: payment.wompiPaymentLinkId,
          checkoutUrl: payment.checkoutUrl,
          paidAt: payment.paidAt ?? null,
          status: payment.status === PaymentStatus.APPROVED ? PaymentLinkStatus.PAID : undefined
        }
      })
      .catch((err) => {
        logIgnored(err, "payment link: failed to upsert existing link", { subscriptionId: sub.id, paymentId: payment.id });
      });
    return {
      paymentId: payment.id,
      wompiPaymentLinkId: payment.wompiPaymentLinkId,
      checkoutUrl: payment.checkoutUrl
    };
  }

  const lockKey = `${PAYMENT_LINK_LOCK_PREFIX}:${subscriptionCycleKey}`;
  const locked = await tryAcquirePaymentLinkLock(lockKey);
  if (!locked) {
    for (let attempt = 0; attempt < 4; attempt++) {
      await delay(250);
      const existing = await prisma.payment.findUnique({
        where: { id: payment.id },
        select: { checkoutUrl: true, wompiPaymentLinkId: true }
      });
      if (existing?.checkoutUrl && existing?.wompiPaymentLinkId) {
        return {
          paymentId: payment.id,
          wompiPaymentLinkId: existing.wompiPaymentLinkId,
          checkoutUrl: existing.checkoutUrl
        };
      }
    }
    await systemLog(LogLevel.WARN, "subscriptions.payment_link", "Payment link creation already in progress", {
      subscriptionId: sub.id,
      paymentId: payment.id
    }).catch((err) => {
      logIgnored(err, "payment link: failed to write system log", { subscriptionId: sub.id, paymentId: payment.id });
    });
    throw new Error("payment_link_in_progress");
  }

  let lockReleased = false;
  const releaseLock = async () => {
    if (lockReleased) return;
    lockReleased = true;
    await releasePaymentLinkLock(lockKey).catch((err) => {
      logIgnored(err, "payment link: failed to release advisory lock", { lockKey });
    });
  };

  let created: Awaited<ReturnType<WompiClient["createPaymentLink"]>>;
  let updated: { id: string; checkoutUrl: string | null; wompiPaymentLinkId: string | null } | null = null;
  try {
    const existing = await prisma.payment.findUnique({
      where: { id: payment.id },
      select: { checkoutUrl: true, wompiPaymentLinkId: true }
    });
    if (existing?.checkoutUrl && existing?.wompiPaymentLinkId) {
      await releaseLock();
      return {
        paymentId: payment.id,
        wompiPaymentLinkId: existing.wompiPaymentLinkId,
        checkoutUrl: existing.checkoutUrl
      };
    }

    const privateKey = await getWompiPrivateKey();
    if (!privateKey) throw new Error("wompi_private_key_not_configured");

    const wompi = new WompiClient({
      apiBaseUrl: await getWompiApiBaseUrl(),
      privateKey,
      checkoutLinkBaseUrl: await getWompiCheckoutLinkBaseUrl()
    });

    try {
      const redirectUrl = await getWompiRedirectUrl();
      const periodicidad = formatPeriodicity(sub.plan.intervalUnit, sub.plan.intervalCount);
      const monto = formatCop(amountInCents);
      const cliente = sub.customer?.name || sub.customer?.email || "Cliente";
      const producto = sub.plan?.name || "Suscripción";
      const rawConfig = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
      let cfg: CheckoutConfig | null = null;
      try {
        const parsed = rawConfig ? JSON.parse(rawConfig) : null;
        cfg = parsed && typeof parsed === "object" ? (parsed as CheckoutConfig) : null;
      } catch {
        cfg = null;
      }
      const collectionMode = String((sub.plan.metadata as PlanMetadata | null)?.collectionMode || "MANUAL_LINK");
      const isPlan = collectionMode === "AUTO_LINK";
      const baseTitle = String(isPlan ? cfg?.planTitle : cfg?.subscriptionTitle || "").trim();
      const baseDesc = String(isPlan ? cfg?.planDescription : cfg?.subscriptionDescription || "").trim();
      const templateId = String((sub.metadata as SubscriptionMetadata | null)?.templateId || "").trim();
      const template =
        templateId
          ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } })
          : null;
      const templateOk =
        template &&
        String(template.kind || "").toUpperCase() === (isPlan ? "PLAN" : "SUBSCRIPTION")
          ? template
          : null;
      const templateTitle = String(templateOk?.publicTitle || templateOk?.wompiTitle || baseTitle || "").trim();
      const templateDesc = String(templateOk?.publicDescription || templateOk?.wompiDescription || baseDesc || "").trim();
      const vars = {
        contacto: cliente,
        producto,
        monto,
        periodicidad,
        fecha_expira: ""
      };
      const wompiTitle = templateTitle ? replaceVars(templateTitle, vars) : `${producto} · ${cliente}`;
      const wompiDescription = templateDesc ? replaceVars(templateDesc, vars) : `${producto} (${periodicidad}) · ${monto} · ciclo ${cycle}`;
      created = await wompi.createPaymentLink({
        name: wompiTitle,
        description: wompiDescription,
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
      }).catch((logErr) => {
        logIgnored(logErr, "payment link: failed to write error system log", { subscriptionId: sub.id, paymentId: payment.id });
      });
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

    updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        wompiPaymentLinkId: created.id,
        checkoutUrl: created.checkoutUrl
      }
    });
    const updatedId = updated?.id ?? payment.id;

    await prisma.paymentLink
      .upsert({
        where: { paymentId: updated.id },
      create: {
          tenantId,
          planId: sub.planId,
          subscriptionId: sub.id,
          paymentId: updated.id,
          wompiPaymentLinkId: created.id,
          checkoutUrl: updated.checkoutUrl || created.checkoutUrl,
          status: PaymentLinkStatus.SENT,
          sentAt: new Date()
        },
        update: {
          tenantId,
          planId: sub.planId,
          subscriptionId: sub.id,
          wompiPaymentLinkId: created.id,
          checkoutUrl: updated.checkoutUrl || created.checkoutUrl
        }
      })
      .catch((err) => {
        logIgnored(err, "payment link: failed to upsert payment link", { subscriptionId: sub.id, paymentId: updatedId });
      });

    await systemLog(LogLevel.INFO, "subscriptions.payment_link", "Payment link created", {
      subscriptionId: sub.id,
      paymentId: updatedId,
      wompiPaymentLinkId: created.id
    }).catch((err) => {
      logIgnored(err, "payment link: failed to write system log", { subscriptionId: sub.id, paymentId: updatedId });
    });
  } finally {
    await releaseLock();
  }

  if (!updated || !created) {
    throw new Error("payment_link_not_created");
  }

  await schedulePaymentLinkNotifications({ paymentId: updated.id, forceNow: true }).catch((err) => {
    logIgnored(err, "payment link: failed to schedule notifications", { paymentId: updated.id });
  });

  const chatwoot = await getChatwootConfig();
  if (chatwoot.configured) {
    await syncChatwootAttributesForCustomer(sub.customerId).catch((err) => {
      logIgnored(err, "payment link: failed to sync chatwoot attributes", { customerId: sub.customerId });
    });
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
  const tenantId = sub.tenantId || sub.plan?.tenantId;
  if (!tenantId) throw new Error("tenant_required");
  if (sub.status === SubscriptionStatus.CANCELED) throw new Error("subscription_canceled");
  if (sub.status === SubscriptionStatus.SUSPENDED) throw new Error("subscription_suspended");
  if (sub.status === SubscriptionStatus.EXPIRED) throw new Error("subscription_expired");

  const collectionMode = resolveSubscriptionCollectionMode(sub);
  if (collectionMode !== "AUTO_DEBIT") {
    throw new Error("auto_debit_not_allowed_for_collection_mode");
  }

  const paymentSourceId = (() => {
    const meta = ((sub.customer.metadata as CustomerMetadata) ?? {}) as CustomerMetadata;
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
  const subscriptionTotal = readSubscriptionTotalInCents(sub.metadata);
  const amountInCents = Math.trunc(args.amountInCentsOverride ?? subscriptionTotal ?? sub.plan.priceInCents);
  const currency = validateWompiCurrency(sub.plan.currency);

  const subscriptionCycleKey = `${sub.id}:${cycle}`;
  const existingByCycle = await prisma.payment.findUnique({
    where: { subscriptionCycleKey },
    select: { id: true, status: true, wompiTransactionId: true }
  });

  if (existingByCycle?.status === PaymentStatus.APPROVED) {
    if (existingByCycle.wompiTransactionId) {
      return { paymentId: existingByCycle.id, wompiTransactionId: existingByCycle.wompiTransactionId };
    }
    throw new Error("payment_already_approved");
  }

  const payment = await prisma.payment.upsert({
    where: { subscriptionCycleKey },
    create: {
      tenantId,
      customerId: sub.customerId,
      subscriptionId: sub.id,
      amountInCents,
      currency,
      cycleNumber: cycle,
      reference,
      status: PaymentStatus.PENDING,
      subscriptionCycleKey
    },
    update: {
      tenantId,
      amountInCents,
      currency,
      reference
    }
  });

  if (payment.wompiTransactionId) {
    return { paymentId: payment.id, wompiTransactionId: payment.wompiTransactionId };
  }

  const lockKey = `${AUTO_DEBIT_LOCK_PREFIX}:${subscriptionCycleKey}`;
  const locked = await tryAcquirePaymentLinkLock(lockKey);
  if (!locked) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await delay(250);
      const existing = await prisma.payment.findUnique({
        where: { id: payment.id },
        select: { wompiTransactionId: true, status: true }
      });
      if (existing?.wompiTransactionId) {
        return { paymentId: payment.id, wompiTransactionId: existing.wompiTransactionId };
      }
      if (existing?.status === PaymentStatus.APPROVED) {
        throw new Error("payment_already_approved");
      }
    }
    await systemLog(LogLevel.WARN, "subscriptions.auto_debit", "Auto debit already in progress", {
      subscriptionId: sub.id,
      paymentId: payment.id
    }).catch(() => {});
    throw new Error("auto_debit_in_progress");
  }

  let lockReleased = false;
  const releaseLock = async () => {
    if (lockReleased) return;
    lockReleased = true;
    await releasePaymentLinkLock(lockKey).catch((err) => {
      logIgnored(err, "auto debit: failed to release advisory lock", { lockKey });
    });
  };

  const privateKey = await getWompiPrivateKey();
  if (!privateKey) {
    await releaseLock();
    throw new Error("wompi_private_key_not_configured");
  }
  const integritySecret = await getWompiIntegritySecret();
  if (!integritySecret) {
    await releaseLock();
    throw new Error("wompi_integrity_secret_not_configured");
  }
  const publicKey = await getWompiPublicKey();
  if (!publicKey) {
    await releaseLock();
    throw new Error("wompi_public_key_not_configured");
  }

  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey, checkoutLinkBaseUrl });
  let merchant: Awaited<ReturnType<WompiClient["getMerchant"]>>;
  try {
    merchant = await wompi.getMerchant(publicKey);
  } catch (err) {
    await releaseLock();
    throw err;
  }

  const signFor = (ref: string) =>
    buildWompiTransactionSignature({
      reference: ref,
      amountInCents,
      currency,
      integritySecret
    });
  let usedReference = reference;
  let created: Awaited<ReturnType<WompiClient["createTransaction"]>>;
  try {
    const existingAfterLock = await prisma.payment.findUnique({
      where: { id: payment.id },
      select: { wompiTransactionId: true, status: true }
    });
    if (existingAfterLock?.wompiTransactionId) {
      await releaseLock();
      return { paymentId: payment.id, wompiTransactionId: existingAfterLock.wompiTransactionId };
    }
    if (existingAfterLock?.status === PaymentStatus.APPROVED) {
      await releaseLock();
      throw new Error("payment_already_approved");
    }

    const signed = signFor(usedReference);
    usedReference = signed.normalizedReference;
    created = await wompi.createTransaction({
      amount_in_cents: signed.normalizedAmountInCents,
      currency: signed.normalizedCurrency,
      customer_email: sub.customer.email,
      reference: usedReference,
      signature: signed.signature,
      acceptance_token: merchant.acceptanceToken,
      accept_personal_auth: merchant.acceptPersonalAuth,
      payment_source_id: paymentSourceId as number,
      recurrent: true,
      payment_method: { installments: 1 }
    });
  } catch (err: any) {
    const errMsg = err?.message ? String(err.message) : "unknown error";
    const duplicateReference =
      /reference/i.test(errMsg) &&
      /(ya ha sido usada|already used|already been used)/i.test(errMsg);

    if (duplicateReference) {
      usedReference = `${reference}_${Date.now()}`;
      await systemLog(LogLevel.WARN, "subscriptions.auto_debit", "Reference duplicada en Wompi; reintentando con nueva referencia", {
        subscriptionId: sub.id,
        paymentId: payment.id,
        previousReference: reference,
        nextReference: usedReference
      }).catch(() => {});

      try {
        const signed = signFor(usedReference);
        usedReference = signed.normalizedReference;
        created = await wompi.createTransaction({
          amount_in_cents: signed.normalizedAmountInCents,
          currency: signed.normalizedCurrency,
          customer_email: sub.customer.email,
          reference: usedReference,
          signature: signed.signature,
          acceptance_token: merchant.acceptanceToken,
          accept_personal_auth: merchant.acceptPersonalAuth,
          payment_source_id: paymentSourceId as number,
          recurrent: true,
          payment_method: { installments: 1 }
        });
      } catch (retryErr: any) {
        const retryMessage = retryErr?.message ? String(retryErr.message) : "unknown error";
        await systemLog(LogLevel.ERROR, "subscriptions.auto_debit", "Transaction create failed after reference retry", {
          subscriptionId: sub.id,
          paymentId: payment.id,
          reference: usedReference,
          amountInCents,
          currency,
          signature: signFor(usedReference).signature,
          err: retryMessage
        }).catch(() => {});
        throw retryErr;
      }
    } else {
      await systemLog(LogLevel.ERROR, "subscriptions.auto_debit", "Transaction create failed (signature details)", {
        subscriptionId: sub.id,
        paymentId: payment.id,
        reference: usedReference,
        amountInCents,
        currency,
        signature: signFor(usedReference).signature,
        err: errMsg
      }).catch((logErr) => {
        logIgnored(logErr, "auto debit: failed to write error system log", { subscriptionId: sub.id, paymentId: payment.id });
      });
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
        err: errMsg
      }).catch((logErr) => {
        logIgnored(logErr, "auto debit: failed to write error system log", { subscriptionId: sub.id, paymentId: payment.id });
      });
      throw err;
    }
  } finally {
    await releaseLock();
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
    data: { reference: usedReference, wompiTransactionId: created.id, providerResponse: created.raw as any }
  });

  await systemLog(LogLevel.INFO, "subscriptions.auto_debit", "Transaction created", {
    subscriptionId: sub.id,
    paymentId: updated.id,
    wompiTransactionId: created.id
  }).catch((err) => {
    logIgnored(err, "auto debit: failed to write system log", { subscriptionId: sub.id, paymentId: updated.id });
  });

  return { paymentId: updated.id, wompiTransactionId: created.id };
}
