import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { PlanType, PublicCheckoutKind, SubscriptionStatus } from "@prisma/client";
import { addIntervalUtc } from "../lib/dates";
import { createPaymentLinkForSubscription } from "../services/subscriptionBilling";
import { scheduleSubscriptionDueNotifications } from "../services/notificationsScheduler";
import { getPublicCheckoutConfig } from "../services/runtimeConfig";

const customerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(6).optional().or(z.literal("")),
  document: z.string().optional().or(z.literal("")),
  documentNumber: z.string().optional().or(z.literal("")),
  address: z
    .object({
      line1: z.string().optional(),
      line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional()
    })
    .optional()
});

const planCheckoutSchema = z.object({
  planId: z.string().uuid().optional(),
  customer: customerSchema
});

const subscriptionCheckoutSchema = z.object({
  planId: z.string().uuid().optional(),
  customer: customerSchema
});

function toMetaCustomer(customer: z.infer<typeof customerSchema>) {
  const meta: any = {
    document: customer.document || undefined,
    documentNumber: customer.documentNumber || undefined
  };
  if (customer.address) {
    meta.address = {
      line1: customer.address.line1 || undefined,
      line2: customer.address.line2 || undefined,
      city: customer.address.city || undefined,
      state: customer.address.state || undefined,
      postalCode: customer.address.postalCode || undefined,
      country: customer.address.country || undefined
    };
  }
  return meta;
}

async function upsertCustomer(payload: z.infer<typeof customerSchema>) {
  const email = payload.email.trim().toLowerCase();
  const existing = await prisma.customer.findFirst({ where: { email } });
  const metadata = toMetaCustomer(payload);
  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        name: payload.name,
        email,
        phone: payload.phone || existing.phone,
        metadata: { ...(existing.metadata as any), ...metadata }
      }
    });
  }
  return prisma.customer.create({
    data: {
      name: payload.name,
      email,
      phone: payload.phone || undefined,
      metadata
    }
  });
}

async function resolveTemplate(slug: string) {
  const template = await prisma.publicCheckoutTemplate.findFirst({
    where: { slug, active: true },
    include: { plan: true }
  });
  return template;
}

async function listPlans(kind: PublicCheckoutKind) {
  const planType = kind === PublicCheckoutKind.PLAN ? PlanType.manual_link : PlanType.auto_subscription;
  return prisma.subscriptionPlan.findMany({
    where: { active: true, planType },
    orderBy: { createdAt: "desc" }
  });
}

export const publicCheckoutRouter = express.Router();

publicCheckoutRouter.get("/checkout/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  if (!slug) return res.status(400).json({ error: "invalid_slug" });
  const template = await resolveTemplate(slug);
  if (!template) return res.status(404).json({ error: "template_not_found" });

  const plans = template.allowPlanSelect || !template.planId ? await listPlans(template.kind) : template.plan ? [template.plan] : [];
  const config = await getPublicCheckoutConfig();

  res.json({
    ok: true,
    template: {
      id: template.id,
      name: template.name,
      slug: template.slug,
      kind: template.kind,
      active: template.active,
      allowPlanSelect: template.allowPlanSelect,
      requireShipping: template.requireShipping,
      requireAddress: template.requireAddress,
      planId: template.planId,
      branding: template.branding || {}
    },
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      priceInCents: p.priceInCents,
      currency: p.currency,
      intervalUnit: p.intervalUnit,
      intervalCount: p.intervalCount,
      planType: p.planType
    })),
    config
  });
});

publicCheckoutRouter.post("/checkout/:slug/plan", async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  const template = await resolveTemplate(slug);
  if (!template || template.kind !== PublicCheckoutKind.PLAN) return res.status(404).json({ error: "template_not_found" });

  const parsed = planCheckoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const planId = template.allowPlanSelect ? parsed.data.planId : template.planId;
  if (!planId) return res.status(400).json({ error: "plan_required" });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active || plan.planType !== PlanType.manual_link) {
    return res.status(400).json({ error: "plan_not_available" });
  }

  const customer = await upsertCustomer(parsed.data.customer);

  const startAt = new Date();
  const periodEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);

  const subscription = await prisma.subscription.create({
    data: {
      customerId: customer.id,
      planId: plan.id,
      status: SubscriptionStatus.PAST_DUE,
      startAt,
      currentPeriodStartAt: startAt,
      currentPeriodEndAt: periodEnd,
      currentCycle: 1
    }
  });

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});

  try {
    const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
    res.status(201).json({ ok: true, checkoutUrl: link.checkoutUrl, paymentLinkId: link.wompiPaymentLinkId });
  } catch (err: any) {
    res.status(502).json({ error: "payment_link_failed", message: err?.message ? String(err.message) : "unknown" });
  }
});

publicCheckoutRouter.post("/checkout/:slug/subscription", async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  const template = await resolveTemplate(slug);
  if (!template || template.kind !== PublicCheckoutKind.SUBSCRIPTION) return res.status(404).json({ error: "template_not_found" });

  const parsed = subscriptionCheckoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const planId = template.allowPlanSelect ? parsed.data.planId : template.planId;
  if (!planId) return res.status(400).json({ error: "plan_required" });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active || plan.planType !== PlanType.auto_subscription) {
    return res.status(400).json({ error: "plan_not_available" });
  }

  const customer = await upsertCustomer(parsed.data.customer);

  const config = await getPublicCheckoutConfig();
  const baseUrl = config.baseUrl || "";
  const linkToken = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + config.tokenExpiryHours * 60 * 60 * 1000);

  const prevMeta: any = customer.metadata ?? {};
  const nextMeta = {
    ...prevMeta,
    tokenizationLink: {
      ...(prevMeta?.tokenizationLink || {}),
      source: "public_checkout",
      token: linkToken,
      templateId: template.id,
      templateSlug: template.slug,
      planId: plan.id,
      kind: template.kind,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      usedAt: null
    }
  };

  await prisma.customer.update({
    where: { id: customer.id },
    data: { metadata: nextMeta }
  });

  const tokenizationUrl = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/public/tokenize/${linkToken}`
    : `/public/tokenize/${linkToken}`;

  res.status(201).json({ ok: true, tokenizationUrl });
});
