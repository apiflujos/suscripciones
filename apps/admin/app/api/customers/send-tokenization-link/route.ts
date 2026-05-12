import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { getCheckoutConfig } from "../../../admin/_services/settings";
import { findCheckoutTemplateForProductOrDefault } from "../../../admin/_services/checkoutTemplates";
import { getCustomerById } from "../../../admin/_services/customers";
import { resolveOperationalPlanForProduct } from "../../../admin/_services/productPlanMapping";
import { scheduleTokenizationLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { firstNotificationDeliveryError } from "@suscripciones/core/services/notificationDelivery";
import { createPublicCheckoutLink } from "@suscripciones/core/services/publicCheckoutLinks";
import { getNotificationsConfig, type NotificationsConfig } from "@suscripciones/core/services/notificationsConfig";
import { logger } from "@suscripciones/core/lib/logger";
import { isNotificationTemplateConfigured, resolveNotificationTemplateForTrigger } from "../../../lib/notificationTemplate";

export async function POST(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch (err: any) {
      logger.warn({ err, actor: auth.session.sub }, "Body inválido en send-tokenization-link");
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const customerId = String(body?.customerId || "").trim();
    const productId = String(body?.productId || "").trim();
    if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });
    if (!productId) return NextResponse.json({ ok: false, error: "missing_product_for_customer" }, { status: 400 });

    const notificationsConfig = await getNotificationsConfig().catch((err: any) => {
      logger.warn({ err, customerId, productId }, "Fallo cargando configuración de notificaciones para tokenization link");
      return null;
    });
    if (notificationsConfig) {
      const cfg = notificationsConfig as NotificationsConfig;
      const tpl = resolveNotificationTemplateForTrigger({
        rules: cfg.rules,
        templates: cfg.templates,
        trigger: "TOKENIZATION_LINK_CREATED"
      });
      if (!isNotificationTemplateConfigured(tpl)) {
        return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
      }
    } else {
      return NextResponse.json({ ok: false, error: "missing_template" }, { status: 400 });
    }

    const checkoutConfig = await getCheckoutConfig();
    const selected = await findCheckoutTemplateForProductOrDefault({
      tenantId: String(body?.tenantId || "").trim() || null,
      kind: "SUBSCRIPTION",
      productId,
      defaultTemplateId: String(checkoutConfig?.defaultSubscriptionTemplateId || "").trim()
    });
    const resolvedTemplateId = selected ? String(selected.id || "") : "";
    if (!resolvedTemplateId) return NextResponse.json({ ok: false, error: "missing_checkout_for_product" }, { status: 400 });
    if (!String(checkoutConfig.subscriptionBaseUrl || "").trim()) {
      return NextResponse.json({ ok: false, error: "missing_subscription_base_url" }, { status: 400 });
    }

    const existing = await getCustomerById(customerId);
    if (!existing) return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    const operationalPlan = await resolveOperationalPlanForProduct({
      productId,
      tenantId: String(body?.tenantId || "").trim() || null
    }).catch((err: any) => {
      logger.warn({ err, customerId, productId }, "Fallo resolviendo plan operativo para tokenization link");
      return null;
    });

    const created = await createPublicCheckoutLink({
      customerId,
      templateId: resolvedTemplateId,
      productId,
      planId: operationalPlan?.id || null
    });
    if (!created?.url) {
      logger.error({ customerId, productId, templateId: resolvedTemplateId }, "No se pudo crear checkout publico de tokenizacion");
      return NextResponse.json({ ok: false, error: "public_checkout_create_failed" }, { status: 500 });
    }

    const schedule = await scheduleTokenizationLinkNotifications({
      customerId,
      tokenUrl: created.url,
      tenantId: String(body?.tenantId || "").trim() || null,
      planId: operationalPlan?.id || null,
      productId,
      forceNow: true,
      actor: auth.session.sub
    });
    const rulesActive = Boolean(schedule?.rulesActive);
    const chatwootError = firstNotificationDeliveryError(schedule) || null;
    if (chatwootError) {
      return NextResponse.json(
        {
          ok: false,
          error: chatwootError,
          link: created.url,
          notificationsScheduled: schedule?.scheduled ?? 0,
          notificationsSent: schedule?.sentNow ?? 0,
          notificationsRulesActive: rulesActive
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      link: created.url,
      notificationsScheduled: schedule?.scheduled ?? 0,
      notificationsSent: schedule?.sentNow ?? 0,
      notificationsRulesActive: rulesActive,
      chatwootError
    });
  } catch (err: any) {
    logger.error({ err, actor: auth.session.sub }, "Fallo en send-tokenization-link");
    return NextResponse.json({ ok: false, error: String(err?.message || "internal_error") }, { status: 500 });
  }
}
