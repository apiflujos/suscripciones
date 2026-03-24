import { CredentialProvider, PublicCheckoutKind } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getCredential } from "./credentials";
import { getCheckoutBaseUrlsFromEnv } from "./publicBase";
import { signPublicToken } from "./publicTokens";

type CheckoutConfig = {
  planBaseUrl?: string;
  subscriptionBaseUrl?: string;
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
  if (kind === "SUBSCRIPTION") {
    return subPath.test(normalized) ? normalized : `${normalized}/public/suscripcion`;
  }
  return planPath.test(normalized) ? normalized : `${normalized}/public/plan`;
}

export async function createPublicCheckoutLink(args: {
  customerId: string;
  templateId: string;
  scope: "payment" | "tokenization";
}): Promise<
  | {
      url: string;
      token: string;
      templateId: string;
      templateName: string;
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
  const base = template.kind === "SUBSCRIPTION" ? subscriptionBase : planBase;
  if (!base) return null;

  const expiryFromTemplate = Number(template.expiryHours || 0);
  const expiryFromCfg = Number(cfg.tokenExpiryHours || 0);
  const hours = Number.isFinite(expiryFromTemplate) && expiryFromTemplate > 0
    ? Math.min(Math.max(Math.trunc(expiryFromTemplate), 1), 168)
    : Number.isFinite(expiryFromCfg) && expiryFromCfg > 0
      ? Math.min(Math.max(Math.trunc(expiryFromCfg), 1), 168)
      : 24;

  const token = await signPublicToken({ sub: customerId, scope: args.scope, ttlSeconds: hours * 60 * 60 });
  const baseUrl = normalizeBase(base, template.kind);
  const rawUrl = `${baseUrl}/${token}`;
  const utm = String(template.utmParams || cfg.defaultUtmParams || "").trim();
  const url = utm ? `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : rawUrl;

  return {
    url,
    token,
    templateId: template.id,
    templateName: template.name,
    expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
    utmParams: utm || null
  };
}
