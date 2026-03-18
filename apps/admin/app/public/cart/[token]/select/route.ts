import crypto from "crypto";
import { prisma } from "@suscripciones/database";
import { CredentialProvider, PlanIntervalUnit, SubscriptionStatus } from "@prisma/client";
import { addIntervalUtc } from "@suscripciones/core/lib/dates";
import { createPaymentLinkForSubscription } from "@suscripciones/core/services/subscriptionBilling";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { getCredential } from "@suscripciones/core/services/credentials";
import { getCheckoutBaseUrlsFromEnv } from "@suscripciones/core/services/publicBase";
import { ensurePaymentRetryJob } from "@suscripciones/core/services/retryJobScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutConfig = {
  planBaseUrl?: string;
  subscriptionBaseUrl?: string;
  defaultUtmParams?: string;
  tokenExpiryHours?: number;
};

type CartLinkMeta = {
  token?: string;
  expiresAt?: string;
  templateId?: string;
};

type PlanMetadata = {
  collectionMode?: string;
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

function parseCheckoutConfig(raw: string | null) {
  let parsed: CheckoutConfig | null = null;
  try {
    const json = raw ? JSON.parse(raw) : null;
    parsed = json && typeof json === "object" ? (json as CheckoutConfig) : null;
  } catch {
    parsed = null;
  }
  const envBases = getCheckoutBaseUrlsFromEnv();
  const planBaseUrl = String(parsed?.planBaseUrl || envBases.planBaseUrl || "").trim();
  const subscriptionBaseUrl = String(parsed?.subscriptionBaseUrl || envBases.subscriptionBaseUrl || "").trim();
  const defaultUtmParams = String(parsed?.defaultUtmParams || "").trim();
  const tokenExpiryHours = Number(parsed?.tokenExpiryHours || 24);
  return { planBaseUrl, subscriptionBaseUrl, defaultUtmParams, tokenExpiryHours };
}

function normalizeCheckoutBase(raw: string, kind: "plan" | "suscripcion") {
  const base = String(raw || "").trim().replace(/\/+$/g, "");
  if (!base) return "";
  const suffix = kind === "plan" ? "/public/plan" : "/public/suscripcion";
  if (base.toLowerCase().endsWith(suffix)) return base.slice(0, -suffix.length);
  return base;
}

function buildPublicUrl(base: string, path: string, utm: string) {
  const normalized = base.replace(/\/$/, "");
  const url = `${normalized}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!utm) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}`;
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;
  const token = String(params?.token || "").trim();
  if (!token) return Response.json({ error: "missing_token" }, { status: 400 });

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["cartLink", "token"], equals: token } as any }
  });
  if (!customer) return Response.json({ error: "token_not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const planId = String(body?.planId || "").trim();
  if (!planId) return Response.json({ error: "missing_plan_id" }, { status: 400 });

  const meta = (customer.metadata ?? {}) as { cartLink?: CartLinkMeta };
  const link = meta?.cartLink ?? {};
  const templateId = String(link?.templateId || "").trim();
  const template = templateId ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } }) : null;
  if (!template || String(template.kind) !== "CART") {
    return Response.json({ error: "template_not_found" }, { status: 404 });
  }

  const templateProductIds = Array.isArray(template.productIds) ? template.productIds : [];
  if (!templateProductIds.includes(planId)) {
    return Response.json({ error: "plan_not_allowed" }, { status: 400 });
  }

  const plan = (await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    include: { tenantLinks: true }
  })) as PlanPublic | null;
  if (!plan) return Response.json({ error: "plan_not_found" }, { status: 404 });

  const rawConfig = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
  const cfg = parseCheckoutConfig(rawConfig);
  const collectionMode = String((plan.metadata as PlanMetadata | null)?.collectionMode || "MANUAL_LINK");

  if (collectionMode === "AUTO_DEBIT") {
    const base = normalizeCheckoutBase(cfg.subscriptionBaseUrl, "suscripcion");
    if (!base) return Response.json({ error: "missing_subscription_base_url" }, { status: 400 });
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
        tenantId: template.tenantId,
        kind: "SUBSCRIPTION",
        templateId: null,
        createdAt: new Date().toISOString(),
        expiresAt,
        usedAt: null
      }
    };
    await prisma.customer.update({ where: { id: customer.id }, data: { metadata: nextMeta as any } });
    return Response.json({ ok: true, nextUrl, kind: "SUBSCRIPTION" });
  }

  const startAt = new Date();
  const periodEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);
  const subscription = await prisma.subscription.create({
    data: {
      tenantId: template.tenantId,
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

  if (collectionMode === "AUTO_DEBIT" || collectionMode === "AUTO_LINK") {
    await ensurePaymentRetryJob({ subscriptionId: subscription.id, runAt: periodEnd, maxAttempts: 1 }).catch(() => {});
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
      .catch(() => {});
    await prisma.customerTenant
      .createMany({ data: tenantIds.map((t) => ({ customerId: customer.id, tenantId: t })), skipDuplicates: true })
      .catch(() => {});
  }

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});
  const linkCreated = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
  const base = normalizeCheckoutBase(cfg.planBaseUrl, "plan");
  if (!base) return Response.json({ error: "missing_plan_base_url" }, { status: 400 });
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

  return Response.json({ ok: true, nextUrl: publicUrl, kind: "PLAN" });
}
