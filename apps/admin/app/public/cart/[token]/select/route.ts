import { prisma } from "@suscripciones/database";
import { CredentialProvider, PlanIntervalUnit, SubscriptionStatus } from "@prisma/client";
import { addIntervalUtc } from "@suscripciones/core/lib/dates";
import { createPaymentLinkForSubscription } from "@suscripciones/core/services/subscriptionBilling";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { createPublicCheckoutLink } from "@suscripciones/core/services/publicCheckoutLinks";
import { getCredential } from "@suscripciones/core/services/credentials";
import { ensurePaymentRetryJob } from "@suscripciones/core/services/retryJobScheduler";
import { getPaymentsConfig } from "@suscripciones/core/services/runtimeConfig";
import { computeBillingCycleDueAt, ensureBillingCyclesForSubscription } from "@suscripciones/core/services/billingCycles";
import { verifyPublicToken } from "../../../../../lib/publicTokens";
import { logger } from "@suscripciones/core/lib/logger";
import { findCheckoutTemplateForProductOrDefault, listCheckoutSelectableProducts } from "../../../../admin/_services/checkoutTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CartLinkMeta = {
  token?: string;
  expiresAt?: string;
  templateId?: string;
};

type PlanMetadata = {
  collectionMode?: string;
  catalog?: { itemId?: string };
};

type PlanPublic = {
  id: string;
  name: string;
  priceInCents: number;
  currency: string;
  intervalUnit: PlanIntervalUnit;
  intervalCount: number;
  metadata?: unknown;
  tenantId?: string | null;
  tenantLinks?: Array<{ tenantId?: string | null }>;
};

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;
  const token = String(params?.token || "").trim();
  if (!token) return Response.json({ error: "missing_token" }, { status: 400 });

  const jwt = await verifyPublicToken(token, "cart");
  if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["cartLink", "token"], equals: token } as any }
  });
  if (!customer) return Response.json({ error: "token_not_found" }, { status: 404 });

  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  let planId = "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch((err: any) => {
      logger.warn({ err, token, customerId: customer.id }, "Body invalido JSON en cart select");
      return null;
    });
    planId = String(body?.planId || "").trim();
  } else {
    const form = await req.formData().catch((err: any) => {
      logger.warn({ err, token, customerId: customer.id }, "Body invalido formData en cart select");
      return null;
    });
    planId = String(form?.get("planId") || "").trim();
  }
  if (!planId) return Response.json({ error: "missing_plan_id" }, { status: 400 });

  const meta = (customer.metadata ?? {}) as { cartLink?: CartLinkMeta };
  const link = meta?.cartLink ?? {};
  const templateId = String(link?.templateId || "").trim();
  const template = templateId ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } }) : null;
  if (!template || String(template.kind) !== "CART") {
    return Response.json({ error: "template_not_found" }, { status: 404 });
  }

  const parseTemplateProducts = (raw: any): Array<{ id: string; mode?: string }> => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        if (typeof entry === "string") return { id: entry };
        const id = String(entry?.id || "").trim();
        if (!id) return null;
        const mode = String(entry?.mode || "").trim();
        return { id, mode };
      })
      .filter(Boolean) as Array<{ id: string; mode?: string }>;
  };

  const templateProducts = parseTemplateProducts(template.productIds);
  const selectedTemplateProduct = templateProducts.find((p) => String(p.id) === planId);
  const selectableProducts = await listCheckoutSelectableProducts({ template });
  const isSelectableProduct = (selectableProducts.items || []).some((item: any) => String(item?.id || "") === planId);
  if (!isSelectableProduct) {
    return Response.json({ error: "plan_not_allowed" }, { status: 400 });
  }

  const plan = (await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    include: { tenantLinks: true }
  })) as PlanPublic | null;
  if (!plan) return Response.json({ error: "plan_not_found" }, { status: 404 });

  const rawConfig = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
  let cfg: any = {};
  try {
    cfg = rawConfig ? JSON.parse(rawConfig) : {};
  } catch (err: any) {
    logger.warn({ err }, "Fallo parseando checkout config en cart select");
    cfg = {};
  }
  const collectionMode = String(
    selectedTemplateProduct?.mode || (plan.metadata as PlanMetadata | null)?.collectionMode || "MANUAL_LINK"
  ).toUpperCase();
  const productId = String((plan.metadata as PlanMetadata | null)?.catalog?.itemId || "").trim();
  const scopeTenantId = String(template.tenantId || plan.tenantId || "").trim() || null;

  if (collectionMode === "AUTO_DEBIT") {
    const checkoutTemplate = await findCheckoutTemplateForProductOrDefault({
      tenantId: scopeTenantId,
      kind: "SUBSCRIPTION" as any,
      productId,
      defaultTemplateId: String(cfg?.defaultSubscriptionTemplateId || "").trim()
    });
    if (!checkoutTemplate) return Response.json({ error: "missing_checkout_for_product" }, { status: 400 });
    if (!String(cfg?.subscriptionBaseUrl || "").trim()) {
      return Response.json({ error: "missing_subscription_base_url" }, { status: 400 });
    }
    const created = await createPublicCheckoutLink({
      customerId: customer.id,
      templateId: String((checkoutTemplate as any).id || ""),
      planId
    });
    if (!created?.url) return Response.json({ error: "public_checkout_create_failed" }, { status: 500 });
    return Response.json({ ok: true, nextUrl: created.url, kind: "SUBSCRIPTION" });
  }

  const startAt = new Date();
  const manualCheckoutTemplate = await findCheckoutTemplateForProductOrDefault({
    tenantId: scopeTenantId,
    kind: "PLAN" as any,
    productId,
    defaultTemplateId: String(cfg?.defaultPlanTemplateId || "").trim()
  });
  const periodEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);
  const paymentsConfig = await getPaymentsConfig().catch(() => null);
  const cycleStartDay = Math.max(1, Math.min(31, Math.trunc(paymentsConfig?.defaultCycleStartDay || 1)));
  const paymentDay = Math.max(1, Math.min(31, Math.trunc(paymentsConfig?.defaultPaymentDay || cycleStartDay)));
  const paymentTiming = String(paymentsConfig?.defaultPaymentTiming || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";
  const graceDays = Math.max(0, Math.trunc(paymentsConfig?.defaultGraceDays || 0));
  const dueAt =
    plan.intervalUnit === PlanIntervalUnit.MONTH
      ? computeBillingCycleDueAt({
          periodStartAt: startAt,
          periodEndAt: periodEnd,
          cycleStartDay,
          paymentDay,
          paymentTiming
        })
      : periodEnd;
  const dueWithGraceAt = new Date(dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
  const subscription = await prisma.subscription.create({
    data: {
      tenantId: template.tenantId,
      customerId: customer.id,
      planId: plan.id,
      status: dueWithGraceAt.getTime() < Date.now() ? SubscriptionStatus.PAST_DUE : SubscriptionStatus.ACTIVE,
      startAt,
      cycleStartDay,
      paymentDay,
      paymentTiming,
      graceDays,
      metadata: { templateId: String((manualCheckoutTemplate as any)?.id || "") || null }
    }
  });

  await ensureBillingCyclesForSubscription({
    id: subscription.id,
    startAt: subscription.startAt,
    currentCycle: 1,
    currentPeriodStartAt: startAt,
    currentPeriodEndAt: periodEnd,
    cycleStartDay: subscription.cycleStartDay,
    paymentDay: subscription.paymentDay,
    paymentTiming: subscription.paymentTiming as any,
    graceDays: subscription.graceDays,
    plan: {
      intervalUnit: plan.intervalUnit,
      intervalCount: plan.intervalCount
    }
  }).catch((err: any) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo generando ciclos desde cart select");
  });

  if (collectionMode === "AUTO_DEBIT" || collectionMode === "AUTO_LINK") {
    await ensurePaymentRetryJob({ subscriptionId: subscription.id, runAt: dueAt, maxAttempts: 1 }).catch((err: any) => {
      logger.warn({ err, subscriptionId: subscription.id, dueAt }, "Fallo programando payment retry desde cart select");
    });
  }

  const tenantIds = Array.from(
    new Set(
      [
        plan.tenantId,
        ...(((plan.tenantLinks || []) as Array<{ tenantId?: string | null }>).map((t) => t.tenantId) as string[])
      ].filter(Boolean) as string[]
    )
  );
  if (tenantIds.length) {
    await prisma.subscriptionTenant
      .createMany({
        data: tenantIds.map((t) => ({ subscriptionId: subscription.id, tenantId: t })),
        skipDuplicates: true
      })
      .catch((err: any) => {
        logger.warn({ err, subscriptionId: subscription.id, tenantIds }, "Fallo creando subscription tenants desde cart select");
      });
    await prisma.customerTenant
      .createMany({ data: tenantIds.map((t) => ({ customerId: customer.id, tenantId: t })), skipDuplicates: true })
      .catch((err: any) => {
        logger.warn({ err, customerId: customer.id, tenantIds }, "Fallo creando customer tenants desde cart select");
      });
  }

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch((err: any) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo programando notificaciones de vencimiento desde cart select");
  });
  const linkCreated = await createPaymentLinkForSubscription({ subscriptionId: subscription.id, sendNotifications: false });
  const checkoutTemplate = manualCheckoutTemplate;
  if (!checkoutTemplate) return Response.json({ error: "missing_checkout_for_product" }, { status: 400 });
  if (!String(cfg?.planBaseUrl || "").trim()) return Response.json({ error: "missing_plan_base_url" }, { status: 400 });
  const created = await createPublicCheckoutLink({
    customerId: customer.id,
    templateId: String((checkoutTemplate as any).id || ""),
    checkoutUrl: linkCreated.checkoutUrl
  });
  if (!created?.url) return Response.json({ error: "public_checkout_create_failed" }, { status: 500 });
  return Response.json({ ok: true, nextUrl: created.url, kind: "PLAN" });
}
