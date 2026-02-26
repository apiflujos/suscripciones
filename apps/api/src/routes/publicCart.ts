import express from "express";
import crypto from "crypto";
import { prisma } from "../db/prisma";
import { addIntervalUtc } from "../lib/dates";
import { createPaymentLinkForSubscription } from "../services/subscriptionBilling";
import { scheduleSubscriptionDueNotifications } from "../services/notificationsScheduler";
import type { Prisma } from "@prisma/client";
import { CredentialProvider, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { getCredential } from "../services/credentials";

function parseCheckoutConfig(raw: string | null) {
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const planBaseUrl = String(parsed?.planBaseUrl || "").trim();
  const subscriptionBaseUrl = String(parsed?.subscriptionBaseUrl || "").trim();
  const defaultUtmParams = String(parsed?.defaultUtmParams || "").trim();
  const tokenExpiryHours = Number(parsed?.tokenExpiryHours || 24);
  return { planBaseUrl, subscriptionBaseUrl, defaultUtmParams, tokenExpiryHours };
}

function buildPublicUrl(base: string, path: string, utm: string) {
  const normalized = base.replace(/\/$/, "");
  const url = `${normalized}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!utm) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}`;
}

export const publicCartRouter = express.Router();

type SubscriptionPlanItem = Prisma.SubscriptionPlanGetPayload<{}>;
type SubscriptionPlanWithLinks = Prisma.SubscriptionPlanGetPayload<{ include: { tenantLinks: true } }>;

publicCartRouter.get("/cart/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "missing_token" });

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["cartLink", "token"], equals: token } as any }
  });
  if (!customer) return res.status(404).json({ error: "token_not_found" });

  const meta: any = customer.metadata ?? {};
  const link = meta?.cartLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ error: "token_expired" });
  }

  const templateId = String(link?.templateId || "").trim();
  const template = templateId
    ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } })
    : null;
  if (!template || String(template.kind) !== "CART") {
    return res.status(404).json({ error: "template_not_found" });
  }

  const productIds = Array.isArray(template.productIds) ? template.productIds : [];
  const plans: SubscriptionPlanItem[] = productIds.length
    ? await prisma.subscriptionPlan.findMany({ where: { id: { in: productIds } } })
    : [];

  res.json({
    ok: true,
    customer: {
      id: customer.id,
      name: customer.name || "",
      email: customer.email || "",
      phone: customer.phone || ""
    },
    template: {
      id: template.id,
      name: template.name,
      kind: template.kind,
      logoUrl: template.logoUrl || null,
      publicTitle: template.publicTitle || null,
      publicDescription: template.publicDescription || null,
      wompiTitle: template.wompiTitle || null,
      wompiDescription: template.wompiDescription || null,
      layout: template.layout || null
    },
    products: plans.map((p) => ({
      id: p.id,
      name: p.name,
      priceInCents: p.priceInCents,
      currency: p.currency,
      intervalUnit: p.intervalUnit,
      intervalCount: p.intervalCount,
      collectionMode: String((p.metadata as any)?.collectionMode || "MANUAL_LINK")
    }))
  });
});

publicCartRouter.post("/cart/:token/select", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "missing_token" });

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["cartLink", "token"], equals: token } as any }
  });
  if (!customer) return res.status(404).json({ error: "token_not_found" });

  const planId = String(req.body?.planId || "").trim();
  if (!planId) return res.status(400).json({ error: "missing_plan_id" });

  const meta: any = customer.metadata ?? {};
  const link = meta?.cartLink ?? {};
  const templateId = String(link?.templateId || "").trim();
  const template = templateId
    ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } })
    : null;
  if (!template || String(template.kind) !== "CART") {
    return res.status(404).json({ error: "template_not_found" });
  }

  const templateProductIds = Array.isArray(template.productIds) ? template.productIds : [];
  if (!templateProductIds.includes(planId)) {
    return res.status(400).json({ error: "plan_not_allowed" });
  }

  const plan: SubscriptionPlanWithLinks | null = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    include: { tenantLinks: true }
  });
  if (!plan) return res.status(404).json({ error: "plan_not_found" });

  const rawConfig = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
  const cfg = parseCheckoutConfig(rawConfig);
  const collectionMode = String((plan.metadata as any)?.collectionMode || "MANUAL_LINK");

  if (collectionMode === "AUTO_DEBIT") {
    const base = cfg.subscriptionBaseUrl.replace(/\/$/, "");
    if (!base) return res.status(400).json({ error: "missing_subscription_base_url" });
    const linkToken = crypto.randomBytes(18).toString("hex");
    const nextUrl = buildPublicUrl(base, `/public/suscripcion/${linkToken}`, cfg.defaultUtmParams);
    const expiryHours = Number.isFinite(cfg.tokenExpiryHours) && cfg.tokenExpiryHours > 0 ? Math.min(Math.max(Math.trunc(cfg.tokenExpiryHours), 1), 168) : 24;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();
    const nextMeta = {
      ...meta,
      tokenizationLink: {
        url: nextUrl,
        token: linkToken,
        planId,
        kind: "SUBSCRIPTION",
        templateId: null,
        createdAt: new Date().toISOString(),
        expiresAt,
        usedAt: null
      }
    };
    await prisma.customer.update({ where: { id: customer.id }, data: { metadata: nextMeta as any } });
    return res.json({ ok: true, nextUrl, kind: "SUBSCRIPTION" });
  }

  const startAt = new Date();
  const periodEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);
  const subscription = await prisma.subscription.create({
    data: {
      tenantId: plan.tenantId ?? null,
      customerId: customer.id,
      planId: plan.id,
      status: SubscriptionStatus.PAST_DUE,
      startAt,
      currentPeriodStartAt: startAt,
      currentPeriodEndAt: periodEnd,
      currentCycle: 1,
      metadata: { templateId: null }
    }
  });

  const tenantIds = Array.from(
    new Set(
      [plan.tenantId, ...((plan.tenantLinks || []).map((t) => t.tenantId) as string[])].filter(Boolean) as string[]
    )
  );
  if (tenantIds.length) {
    await prisma.subscriptionTenant
      .createMany({
        data: tenantIds.map((t) => ({ subscriptionId: subscription.id, tenantId: t })),
        skipDuplicates: true
      })
      .catch(() => {});
  }

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});
  await prisma.retryJob
    .create({
      data: {
        type: RetryJobType.PAYMENT_RETRY,
        runAt: periodEnd,
        payload: { subscriptionId: subscription.id }
      }
    })
    .catch(() => {});

  const linkCreated = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
  const base = cfg.planBaseUrl.replace(/\/$/, "");
  if (!base) return res.status(400).json({ error: "missing_plan_base_url" });
  const linkToken = crypto.randomBytes(18).toString("hex");
  const publicUrl = buildPublicUrl(base, `/public/plan/${linkToken}`, cfg.defaultUtmParams);

  const nextMeta = {
    ...meta,
    paymentLink: {
      url: publicUrl,
      token: linkToken,
      checkoutUrl: linkCreated.checkoutUrl,
      kind: "PLAN",
      templateId: null,
      utmParams: cfg.defaultUtmParams || null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      usedAt: null
    }
  };
  await prisma.customer.update({ where: { id: customer.id }, data: { metadata: nextMeta as any } });

  return res.json({ ok: true, nextUrl: publicUrl, kind: "PLAN" });
});
