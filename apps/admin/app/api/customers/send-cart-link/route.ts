import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { getCheckoutConfig } from "../../../admin/_services/settings";
import { findCheckoutTemplateForProductOrDefault } from "../../../admin/_services/checkoutTemplates";
import { getCustomerById, updateCustomerMetadata } from "../../../admin/_services/customers";
import { firstNotificationDeliveryError } from "@suscripciones/core/services/notificationDelivery";
import { scheduleCatalogLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { createPublicCheckoutLink } from "@suscripciones/core/services/publicCheckoutLinks";
import { getNotificationsConfig, type NotificationsConfig } from "@suscripciones/core/services/notificationsConfig";
import { readCustomerMetadata } from "@suscripciones/core/lib/customerMetadata";
import { logger } from "@suscripciones/core/lib/logger";
import { isNotificationTemplateConfigured, resolveNotificationTemplateForTrigger } from "../../../lib/notificationTemplate";

export async function POST(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  let body: any = null;
  try {
    body = await req.json();
  } catch (err: any) {
    logger.warn({ err }, "Body invalido en send-cart-link");
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const customerId = String(body?.customerId || "").trim();
  const tenantId = String(body?.tenantId || "").trim();
  const productId = String(body?.productId || "").trim();
  const catalogTypeRaw = String(body?.catalogType || "").trim().toUpperCase();
  const catalogType = catalogTypeRaw === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN";
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });

  const notificationsConfig = await getNotificationsConfig().catch((err: any) => {
    logger.warn({ err, customerId, tenantId, productId, catalogType }, "Fallo cargando configuracion de notificaciones para cart link");
    return null;
  });
  if (notificationsConfig) {
    const cfg = notificationsConfig as NotificationsConfig;
    const tpl = resolveNotificationTemplateForTrigger({
      rules: cfg.rules,
      templates: cfg.templates,
      trigger: "CATALOG_LINK_CREATED",
      paymentType: catalogType === "SUBSCRIPTION" ? "SUBSCRIPTION" : "PLAN"
    });
    if (!isNotificationTemplateConfigured(tpl)) {
      return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
  }

  const checkoutConfig = await getCheckoutConfig().catch((err: any) => {
    logger.error({ err, customerId, tenantId, productId, catalogType }, "Fallo cargando checkout config para cart link");
    return null;
  });
  if (!checkoutConfig) {
    return NextResponse.json({ ok: false, error: "missing_public_base_url" }, { status: 500 });
  }

  const selectedTemplate = await findCheckoutTemplateForProductOrDefault({
    tenantId: tenantId || null,
    kind: "CART",
    productId: productId || null,
    defaultTemplateId: String(checkoutConfig?.defaultCartTemplateId || "").trim()
  });
  if (!selectedTemplate) {
    return NextResponse.json({ ok: false, error: productId ? "missing_checkout_for_product" : "missing_cart_template" }, { status: 400 });
  }

  const customer = await getCustomerById(customerId);
  if (!customer) return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
  const created = await createPublicCheckoutLink({
    customerId,
    templateId: String(selectedTemplate.id || "")
  });
  const publicUrl = String(created?.url || "").trim();
  if (!publicUrl) {
    return NextResponse.json({ ok: false, error: "public_checkout_create_failed" }, { status: 500 });
  }
  const prevMeta = readCustomerMetadata(customer.metadata);

  const nextMeta = {
    ...prevMeta,
    cartLink: {
      ...(prevMeta?.cartLink || {}),
      ...(created || {}),
      url: publicUrl,
      token: String(created?.token || "").trim() || prevMeta?.cartLink?.token || undefined,
      templateId: String(selectedTemplate.id || "").trim() || prevMeta?.cartLink?.templateId || undefined,
      catalogType,
      kind: "CART"
    }
  };
  await updateCustomerMetadata({ customerId, metadata: nextMeta }).catch((err: any) => {
    logger.warn({ err, customerId, productId, catalogType }, "Fallo guardando metadata de cart link");
    throw err;
  });

  const schedule = await scheduleCatalogLinkNotifications({
    customerId,
    catalogUrl: publicUrl,
    forceNow: true,
    paymentType: catalogType,
    actor: auth.session.sub
  }).catch((err: any) => {
    logger.error({ err, customerId, productId, catalogType, actor: auth.session.sub }, "Fallo programando o enviando catalog link");
    throw err;
  });
  const rulesActive = Boolean(schedule?.rulesActive);
  if (!rulesActive) {
    return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
  }
  const chatwootError = firstNotificationDeliveryError(schedule) || null;
  if (chatwootError) {
    return NextResponse.json(
      {
        ok: false,
        error: chatwootError,
        link: publicUrl,
        notificationsScheduled: schedule?.scheduled ?? 0,
        notificationsSent: schedule?.sentNow ?? 0,
        notificationsRulesActive: rulesActive
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    link: publicUrl,
    notificationsScheduled: schedule?.scheduled ?? 0,
    notificationsSent: schedule?.sentNow ?? 0,
    notificationsRulesActive: rulesActive,
    chatwootError: null
  });
}
