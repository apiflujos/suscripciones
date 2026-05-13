import { NextResponse } from "next/server";
import { prisma } from "@suscripciones/database";
import { getCheckoutConfig } from "../../../../admin/_services/settings";
import { createWompiPaymentSource, consumeTokenizationLink, updateCustomerProfile } from "../../../../admin/_services/customers";
import { createSubscription } from "../../../../admin/_services/subscriptions";
import { verifyPublicToken } from "../../../../../lib/publicTokens";
import { resolveTokenizationRedirectBase } from "../../../../lib/tokenizationRedirect";
import { logger } from "@suscripciones/core/lib/logger";
import { readCustomerMetadata, type CustomerMetadata } from "@suscripciones/core/lib/customerMetadata";

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
  const requestRedirectBase = resolveTokenizationRedirectBase({
    requestUrl: req.url,
    forwardedProto: req.headers.get("x-forwarded-proto"),
    forwardedHost: req.headers.get("x-forwarded-host"),
    host: req.headers.get("host"),
    envPublicBaseUrl: String(process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "").trim(),
    envRedirectBaseUrl: String(process.env.NEXT_PUBLIC_REDIRECT_BASE_URL || "").trim()
  });
  const jwt = await verifyPublicToken(linkToken, "tokenization");
  if (!jwt) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=unauthorized`, requestRedirectBase));
  }
  let checkoutConfig: any = {};
  try {
    checkoutConfig = await getCheckoutConfig();
  } catch (err: any) {
    logger.warn({ err, linkToken }, "Fallo resolviendo configuracion de redireccion para tokenizacion publica");
  }

  let redirectBase = resolveTokenizationRedirectBase({
    requestUrl: req.url,
    subscriptionBaseUrl: String(checkoutConfig?.subscriptionBaseUrl || "").trim(),
    planBaseUrl: String(checkoutConfig?.planBaseUrl || "").trim(),
    forwardedProto: req.headers.get("x-forwarded-proto"),
    forwardedHost: req.headers.get("x-forwarded-host"),
    host: req.headers.get("host"),
    envPublicBaseUrl: String(process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "").trim(),
    envRedirectBaseUrl: String(process.env.NEXT_PUBLIC_REDIRECT_BASE_URL || "").trim()
  });

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: linkToken } as any }
  });
  if (!customer) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=token_not_found`, redirectBase));
  }

  const meta = readCustomerMetadata(customer.metadata);
  const link = meta.tokenizationLink || {};
  redirectBase = resolveTokenizationRedirectBase({
    requestUrl: req.url,
    storedLinkUrl: String(link?.url || "").trim(),
    subscriptionBaseUrl: String(checkoutConfig?.subscriptionBaseUrl || "").trim(),
    planBaseUrl: String(checkoutConfig?.planBaseUrl || "").trim(),
    forwardedProto: req.headers.get("x-forwarded-proto"),
    forwardedHost: req.headers.get("x-forwarded-host"),
    host: req.headers.get("host"),
    envPublicBaseUrl: String(process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "").trim(),
    envRedirectBaseUrl: String(process.env.NEXT_PUBLIC_REDIRECT_BASE_URL || "").trim()
  });
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
  const linkProductId = String(link?.productId || "").trim();
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

    const freshCustomer = ("customer" in res && res.customer ? res.customer : customer);
    const prevMeta = readCustomerMetadata(freshCustomer?.metadata);
    const prevTokenizationLink = prevMeta.tokenizationLink || {};
    const nextMeta: CustomerMetadata = {
      ...prevMeta,
      tokenizationLink: {
        ...prevTokenizationLink,
        usedAt: prevTokenizationLink?.usedAt || new Date().toISOString()
      }
    };

    await updateCustomerProfile({ customerId, metadata: nextMeta }).catch((err: any) => {
      logger.warn({ err, customerId, linkToken }, "Fallo guardando metadata tras tokenización pública");
    });

    if (linkKind === "SUBSCRIPTION" && (linkProductId || linkPlanId)) {
      try {
        const tenantFromLink = String(link?.tenantId || "").trim();
        const tenantIds = tenantFromLink ? [tenantFromLink] : customer.tenantId ? [String(customer.tenantId)] : [];
        const subRes = await createSubscription({
          customerId,
          ...(linkProductId ? { productId: linkProductId } : {}),
          ...(linkPlanId ? { planId: linkPlanId } : {}),
          tenantIds,
          createPaymentLink: false,
          suppressInitialCollection: true,
          metadata: {
            source: "PUBLIC_TOKENIZATION"
          }
        });
        if (!subRes?.ok) {
          const errorCode = "error" in subRes && subRes.error ? String(subRes.error) : "subscription_create_failed";
          logger.warn({ customerId, productId: linkProductId || null, planId: linkPlanId || null, errorCode }, "No se pudo crear suscripción automática tras tokenización pública");
          return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(errorCode)}`, redirectBase));
        }
        const createdSubscriptionId = subRes.ok && "subscription" in subRes ? String(subRes.subscription?.id || "").trim() : "";
        if (createdSubscriptionId) {
          const finalMeta = {
            ...nextMeta,
            tokenizationLink: { ...(nextMeta.tokenizationLink || {}), subscriptionId: createdSubscriptionId }
          };
          await updateCustomerProfile({ customerId, metadata: finalMeta }).catch((err: any) => {
            logger.warn({ err, customerId, subscriptionId: createdSubscriptionId }, "Fallo guardando subscriptionId en metadata tras tokenización pública");
          });
        } else {
          logger.warn({ customerId, productId: linkProductId || null, planId: linkPlanId || null }, "Tokenización pública sin subscriptionId tras crear suscripción");
          return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=subscription_create_failed`, redirectBase));
        }
      } catch (err: any) {
        logger.warn({ err, customerId, productId: linkProductId || null, planId: linkPlanId || null }, "Fallo creando suscripción automática tras tokenización pública");
        return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=subscription_create_failed`, redirectBase));
      }
    }

    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}/success`, redirectBase));
  } catch (err: any) {
    logger.error({ err, customerId, linkToken }, "Fallo procesando tokenización pública");
    const msg = err?.message ? String(err.message) : "request_failed";
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, redirectBase));
  }
}
