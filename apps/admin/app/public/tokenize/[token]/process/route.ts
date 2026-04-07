import { NextResponse } from "next/server";
import { prisma } from "@suscripciones/database";
import { getCheckoutConfig } from "../../../../admin/_services/settings";
import { createWompiPaymentSource, consumeTokenizationLink, updateCustomerProfile } from "../../../../admin/_services/customers";
import { createSubscription } from "../../../../admin/_services/subscriptions";
import { verifyPublicToken } from "../../../../../lib/publicTokens";
import { logger } from "@suscripciones/core/lib/logger";

function getRedirectBase(req: Request) {
  const envBase =
    String(process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "").trim() ||
    String(process.env.NEXT_PUBLIC_REDIRECT_BASE_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  if (host) {
    const proto = forwardedProto || "https";
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

function normalizeRedirectBase(raw: string) {
  const input = String(raw || "").trim().replace(/\/+$/g, "");
  if (!input) return "";
  try {
    const parsed = new URL(input);
    return parsed.origin;
  } catch {
    return input.replace(/\/public\/(plan|suscripcion)(\/.*)?$/i, "");
  }
}

function detectToken(formData: FormData): string {
  const direct =
    String(formData.get("token") || "").trim() ||
    String(formData.get("wompi_token") || "").trim() ||
    String(formData.get("id") || "").trim();
  if (direct) return direct;

  for (const [, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!v) continue;
    if (v.startsWith("tok_") || v.startsWith("nequi_") || v.startsWith("pse_")) return v;
  }
  return "";
}

function tokenToType(token: string): "CARD" | "NEQUI" | "PSE" {
  if (token.startsWith("nequi_")) return "NEQUI";
  if (token.startsWith("pse_")) return "PSE";
  return "CARD";
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token: linkToken } = await ctx.params;
  const jwt = await verifyPublicToken(linkToken, "tokenization");
  if (!jwt) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=unauthorized`, getRedirectBase(req)));
  }
  let redirectBase = getRedirectBase(req);

  try {
    const checkoutConfig = await getCheckoutConfig();
    const configBase = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
    const normalized = normalizeRedirectBase(configBase);
    if (normalized) redirectBase = normalized;
  } catch (err: any) {
    logger.warn({ err, linkToken }, "Fallo resolviendo base de redirección para tokenización pública");
    const msg = err?.message ? String(err.message) : "missing_next_public_api_base_url";
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, redirectBase));
  }

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: linkToken } as any }
  });
  if (!customer) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=token_not_found`, redirectBase));
  }

  const meta = (customer.metadata ?? {}) as any;
  const link = meta?.tokenizationLink ?? {};
  const usedAt = String(link?.usedAt || "").trim();
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  if (usedAt) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=token_used`, redirectBase));
  }
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=token_expired`, redirectBase));
  }

  const customerId = String(customer?.id || "").trim();
  const customerEmail = String(customer?.email || "").trim();
  const linkPlanId = String(link?.planId || "").trim();
  const linkKind = String(link?.kind || "").trim();
  if (!customerId) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=customer_not_found`, redirectBase));
  if (!customerEmail) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=customer_email_required`, redirectBase));
  }

  const formData = await req.formData().catch((err: any) => {
    logger.warn({ err, linkToken, customerId }, "Fallo leyendo formData en tokenización pública");
    return null;
  });
  if (!formData) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=invalid_form`, redirectBase));
  const acceptTerms = String(formData.get("accept_terms") || "").trim();
  const acceptPersonal = String(formData.get("accept_personal_data") || "").trim();
  if (acceptTerms !== "1" || acceptPersonal !== "1") {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=missing_acceptance`, redirectBase));
  }

  const wompiToken = detectToken(formData);
  if (!wompiToken) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=missing_token`, redirectBase));

  const type = tokenToType(wompiToken);

  try {
    const res = await createWompiPaymentSource({ customerId, type, token: wompiToken });
    if (!res.ok) {
      const error = res.error ? String(res.error) : "No se pudo registrar el método de pago.";
      return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(error)}`, redirectBase));
    }

    await consumeTokenizationLink({ token: linkToken }).catch((err: any) => {
      logger.warn({ err, linkToken, customerId }, "Fallo marcando tokenization link como consumido");
      return null;
    });

    const prevMeta = customer?.metadata ?? {};
    const prevTokenizationLink = (prevMeta as any)?.tokenizationLink || {};
    const nextMeta = {
      ...(prevMeta as any),
      tokenizationLink: {
        ...prevTokenizationLink,
        usedAt: prevTokenizationLink?.usedAt || new Date().toISOString()
      }
    };

    await updateCustomerProfile({ customerId, metadata: nextMeta }).catch((err: any) => {
      logger.warn({ err, customerId, linkToken }, "Fallo guardando metadata tras tokenización pública");
    });

    if (linkKind === "SUBSCRIPTION" && linkPlanId) {
      try {
        const tenantFromLink = String(link?.tenantId || "").trim();
        const tenantIds = tenantFromLink ? [tenantFromLink] : customer.tenantId ? [String(customer.tenantId)] : [];
        const subRes = await createSubscription({
          customerId,
          planId: linkPlanId,
          tenantIds,
          createPaymentLink: false
        });
        if (subRes.ok && (subRes as any)?.subscription?.id) {
          const finalMeta = {
            ...nextMeta,
            tokenizationLink: {
              ...(nextMeta as any)?.tokenizationLink,
              subscriptionId: (subRes as any).subscription.id
            }
          };
          await updateCustomerProfile({ customerId, metadata: finalMeta }).catch((err: any) => {
            logger.warn({ err, customerId, subscriptionId: (subRes as any).subscription.id }, "Fallo guardando subscriptionId en metadata tras tokenización pública");
          });
        }
      } catch (err: any) {
        logger.warn({ err, customerId, planId: linkPlanId }, "Fallo creando suscripción automática tras tokenización pública");
      }
    }

    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}/success`, redirectBase));
  } catch (err: any) {
    logger.error({ err, customerId, linkToken }, "Fallo procesando tokenización pública");
    const msg = err?.message ? String(err.message) : "request_failed";
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, redirectBase));
  }
}
