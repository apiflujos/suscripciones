import { CredentialProvider, PublicCheckoutKind } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getCredential } from "./credentials";
import { getCheckoutBaseUrlsFromEnv } from "./publicBase";
import { signPublicToken } from "./publicTokens";

type CheckoutConfig = {
  planBaseUrl?: string;
  subscriptionBaseUrl?: string;
  cartBaseUrl?: string;
  tokenExpiryHours?: number;
  defaultUtmParams?: string;
};

function ensureHttps(value: string) {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}

function normalizeBase(base: string, kind: PublicCheckoutKind) {
  const normalized = ensureHttps(base).replace(/\/$/, "");
  const planPath = /\/public\/plan$/i;
  const subPath = /\/public\/suscripcion$/i;
  const cartPath = /\/public\/cart$/i;
  if (kind === "SUBSCRIPTION") {
    return subPath.test(normalized) ? normalized : `${normalized}/public/suscripcion`;
  }
  if (kind === "CART") {
    return cartPath.test(normalized) ? normalized : `${normalized}/public/cart`;
  }
  return planPath.test(normalized) ? normalized : `${normalized}/public/plan`;
}

export async function createPublicCheckoutLink(args: {
  customerId: string;
  templateId: string;
  checkoutUrl?: string | null;
  planId?: string | null;
  productId?: string | null;
}): Promise<
  | {
      url: string;
      token: string;
      templateId: string;
      templateName: string;
      kind: PublicCheckoutKind;
      expiresAt: string;
      utmParams: string | null;
    }
  | null
> {
  const customerId = String(args.customerId || "").trim();
  const templateId = String(args.templateId || "").trim();
  if (!customerId || !templateId) return null;

  const template = await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.active === false) return null;

  const rawCfg = await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG");
  let cfg: CheckoutConfig = {};
  try {
    cfg = rawCfg ? JSON.parse(rawCfg) : {};
  } catch {
    cfg = {};
  }
  const envBases = getCheckoutBaseUrlsFromEnv();
  const planBase = String(cfg.planBaseUrl || "").trim() || envBases.planBaseUrl || "";
  const subscriptionBase = String(cfg.subscriptionBaseUrl || "").trim() || envBases.subscriptionBaseUrl || "";
  const cartBase =
    String(cfg.cartBaseUrl || "").trim() ||
    envBases.cartBaseUrl ||
    planBase ||
    subscriptionBase ||
    "";
  const base =
    template.kind === "SUBSCRIPTION"
      ? subscriptionBase
      : template.kind === "CART"
        ? cartBase
        : planBase;
  if (!base) return null;

  const expiryFromTemplate = Number(template.expiryHours || 0);
  const expiryFromCfg = Number(cfg.tokenExpiryHours || 0);
  const hours = Number.isFinite(expiryFromTemplate) && expiryFromTemplate > 0
    ? Math.min(Math.max(Math.trunc(expiryFromTemplate), 1), 168)
    : Number.isFinite(expiryFromCfg) && expiryFromCfg > 0
      ? Math.min(Math.max(Math.trunc(expiryFromCfg), 1), 168)
      : 24;

  const scope = template.kind === "SUBSCRIPTION" ? "tokenization" : template.kind === "CART" ? "cart" : "payment";
  const token = await signPublicToken({ sub: customerId, scope, ttlSeconds: hours * 60 * 60 });
  const baseUrl = normalizeBase(base, template.kind);
  const rawUrl = `${baseUrl}/${token}`;
  const utm = String(template.utmParams || cfg.defaultUtmParams || "").trim();
  const url = utm ? `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : rawUrl;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { metadata: true }
  });
  if (!customer) return null;

  const prevMeta = customer.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? (customer.metadata as any) : {};
  const commonLink = {
    token,
    url,
    templateId: template.id,
    kind: template.kind,
    createdAt: new Date().toISOString(),
    expiresAt,
    usedAt: null,
    utmParams: utm || null
  };
  const nextMeta =
    template.kind === "SUBSCRIPTION"
        ? {
            ...prevMeta,
            tokenizationLink: {
              ...(prevMeta?.tokenizationLink || {}),
              ...commonLink,
              tenantId: template.tenantId || null,
              planId: args.planId ?? prevMeta?.tokenizationLink?.planId ?? null,
              productId: args.productId ?? prevMeta?.tokenizationLink?.productId ?? null
            }
          }
      : template.kind === "CART"
        ? {
            ...prevMeta,
            cartLink: {
              ...(prevMeta?.cartLink || {}),
              ...commonLink,
              tenantId: template.tenantId || null
            }
          }
        : {
            ...prevMeta,
            paymentLink: {
              ...(prevMeta?.paymentLink || {}),
              ...commonLink,
              tenantId: template.tenantId || null,
              checkoutUrl: args.checkoutUrl ?? prevMeta?.paymentLink?.checkoutUrl ?? null,
              templateName: template.name
            }
          };

  await prisma.customer.update({
    where: { id: customerId },
    data: { metadata: nextMeta as any }
  });

  return {
    url,
    token,
    templateId: template.id,
    templateName: template.name,
    kind: template.kind,
    expiresAt,
    utmParams: utm || null
  };
}
