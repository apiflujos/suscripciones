import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { createManualOrder } from "../../../admin/_services/orders";
import { getCheckoutConfig } from "../../../admin/_services/settings";
import { findCheckoutTemplateForProductOrDefault } from "../../../admin/_services/checkoutTemplates";
import { getCustomerById } from "../../../admin/_services/customers";
import { createPublicCheckoutLink } from "@suscripciones/core/services/publicCheckoutLinks";
import { firstNotificationDeliveryError } from "@suscripciones/core/services/notificationDelivery";
import { getNotificationsConfig, type NotificationsConfig } from "@suscripciones/core/services/notificationsConfig";
import { schedulePaymentLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { logger } from "@suscripciones/core/lib/logger";
import { prisma } from "@suscripciones/database";
import { isNotificationTemplateConfigured, resolveNotificationTemplateForTrigger } from "../../../lib/notificationTemplate";

function pesosToCents(input: string): number {
  const digits = String(input || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const pesos = Number(digits);
  if (!Number.isFinite(pesos)) return 0;
  return Math.trunc(pesos) * 100;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  let body: any = null;
  try {
    body = await req.json();
  } catch (err: any) {
    logger.warn({ err }, "Body invalido en send-payment-link");
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const customerId = String(body?.customerId || "").trim();
  const customerName = String(body?.customerName || "").trim() || "Cliente";
  const tenantId = String(body?.tenantId || "").trim();
  const productId = String(body?.productId || "").trim();
  const amountInCents = pesosToCents(String(body?.amount || ""));
  if (!customerId || amountInCents <= 0) {
    return NextResponse.json({ ok: false, error: "monto_invalido" }, { status: 400 });
  }
  if (!productId) {
    return NextResponse.json({ ok: false, error: "missing_product_for_customer" }, { status: 400 });
  }

  const notificationsConfig = await getNotificationsConfig().catch((err: any) => {
    logger.warn({ err, customerId, tenantId, productId }, "Fallo cargando configuracion de notificaciones para payment link");
    return null;
  });
  if (notificationsConfig) {
    const cfg = notificationsConfig as NotificationsConfig;
    const tpl = resolveNotificationTemplateForTrigger({
      rules: cfg.rules,
      templates: cfg.templates,
      trigger: "PAYMENT_LINK_CREATED",
      paymentType: "LINK"
    });
    if (!isNotificationTemplateConfigured(tpl)) {
      return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
  }

  const checkoutConfig = await getCheckoutConfig().catch((err: any) => {
    logger.error({ err, customerId, tenantId, productId }, "Fallo cargando checkout config para payment link");
    return null;
  });
  if (!checkoutConfig || !String(checkoutConfig?.planBaseUrl || "").trim()) {
    return NextResponse.json({ ok: false, error: "missing_plan_base_url" }, { status: 400 });
  }
  const selected = await findCheckoutTemplateForProductOrDefault({
    tenantId: tenantId || null,
    kind: "PLAN",
    productId,
    defaultTemplateId: String(checkoutConfig?.defaultPlanTemplateId || "").trim()
  });
  const resolvedTemplateId = selected ? String(selected.id || "") : "";
  if (!resolvedTemplateId) {
    return NextResponse.json({ ok: false, error: "missing_checkout_for_product" }, { status: 400 });
  }

  const reference = `CONTACT_${customerId.slice(0, 6)}_${Date.now()}`;
  const orderResult = await createManualOrder({
    req,
    body: {
      customerId,
      reference,
      currency: "COP",
      lineItems: [{ name: `Pago de ${customerName}`, quantity: 1, unitPriceInCents: amountInCents }],
      ...(tenantId ? { tenantId } : {}),
      sendChatwoot: false,
      source: "MANUAL"
    }
  });
  if (!orderResult.ok) {
    return NextResponse.json({ ok: false, error: orderResult.error || "request_failed" }, { status: orderResult.status });
  }

  const checkoutUrl = String(orderResult.checkoutUrl || "").trim();
  const paymentId =
    orderResult && typeof orderResult === "object" && "payment" in orderResult
      ? String((orderResult as { payment?: { id?: string } }).payment?.id || "").trim()
      : "";
  if (!paymentId) {
    return NextResponse.json({ ok: false, error: "request_failed" }, { status: 500 });
  }

  let publicUrl: string | null = null;
  try {
    const customer = await getCustomerById(customerId);
    if (!customer) return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    const created = await createPublicCheckoutLink({
      customerId,
      templateId: resolvedTemplateId,
      checkoutUrl
    });
    publicUrl = String(created?.url || "").trim() || null;
    if (created?.token && publicUrl) {
      const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { providerResponse: true, currency: true } });
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          providerResponse: {
            ...asRecord(payment?.providerResponse),
            publicPaymentLink: {
              token: created.token,
              url: publicUrl,
              checkoutUrl,
              templateId: resolvedTemplateId,
              productId,
              amountInCents,
              currency: payment?.currency || "COP",
              createdAt: new Date().toISOString(),
              expiresAt: created.expiresAt || null
            }
          }
        }
      });
    }
  } catch (err: any) {
    logger.warn(
      { err, customerId, tenantId, productId, paymentId, checkoutUrl, resolvedTemplateId },
      "Fallo generando o guardando public payment link"
    );
  }
  if (!publicUrl) {
    return NextResponse.json({ ok: false, error: "public_checkout_create_failed" }, { status: 500 });
  }

  const schedule = await schedulePaymentLinkNotifications({
    paymentId,
    paymentLinkUrl: publicUrl,
    forceNow: true,
    actor: auth.session.sub
  }).catch((err: any) => {
    logger.error({ err, actor: auth.session.sub, customerId, paymentId }, "Fallo programando o enviando payment link");
    throw err;
  });
  const chatwootError = firstNotificationDeliveryError(schedule) || null;
  if (chatwootError) {
    return NextResponse.json(
      {
        ok: false,
        error: chatwootError,
        checkoutUrl: checkoutUrl || null,
        publicUrl,
        hasPublicCheckout: Boolean(publicUrl),
        checkoutTemplateId: resolvedTemplateId || null,
        notificationsScheduled: schedule?.scheduled ?? 0,
        notificationsSent: schedule?.sentNow ?? 0,
        notificationsRulesActive: Boolean(schedule?.rulesActive)
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    checkoutUrl: checkoutUrl || null,
    publicUrl,
    hasPublicCheckout: Boolean(publicUrl),
    checkoutTemplateId: resolvedTemplateId || null,
    notificationsScheduled: schedule?.scheduled ?? 0,
    notificationsSent: schedule?.sentNow ?? 0,
    notificationsRulesActive: Boolean(schedule?.rulesActive),
    chatwootError: null
  });
}
