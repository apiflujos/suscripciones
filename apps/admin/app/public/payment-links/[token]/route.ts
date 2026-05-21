import { prisma } from "@suscripciones/database";
import { LogLevel } from "@prisma/client";
import { getTenantBrand } from "@suscripciones/core/services/tenantBrand";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { tokenMeta } from "@suscripciones/core/lib/tokenMeta";
import { logger } from "@suscripciones/core/lib/logger";
import { verifyPublicToken } from "../../../../lib/publicTokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PaymentLinkMeta = {
  token?: string;
  expiresAt?: string;
  templateId?: string;
  checkoutUrl?: string;
  tenantId?: string;
  amountInCents?: number;
  currency?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return String(value || "").trim();
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;
  const token = String(params?.token || "").trim();
  if (!token) return Response.json({ error: "invalid_token" }, { status: 400 });

  const jwt = await verifyPublicToken(token, "payment");
  if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const ip = String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim();

  const customerFromMetadata = await prisma.customer.findFirst({
    where: { metadata: { path: ["paymentLink", "token"], equals: token } as any }
  });
  const paymentFromToken = await prisma.payment.findFirst({
    where: { providerResponse: { path: ["publicPaymentLink", "token"], equals: token } as any },
    include: { customer: true }
  });
  const customer = customerFromMetadata || paymentFromToken?.customer || null;
  if (!customer) {
    void systemLog(LogLevel.WARN, "public.payment_link", "payment_link_not_found", {
      ...tokenMeta(token),
      ip,
      userAgent: req.headers.get("user-agent") || null
    }).catch((err: any) => {
      logger.warn({ err, token, ip }, "Fallo escribiendo systemLog de payment link not found");
    });
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" }
    });
  }

  const meta = (customer.metadata ?? {}) as { paymentLink?: PaymentLinkMeta };
  const metadataLink = meta?.paymentLink || {};
  const persistedLink = asRecord(asRecord(paymentFromToken?.providerResponse).publicPaymentLink) as PaymentLinkMeta;
  const link = stringValue(persistedLink?.token) === token ? persistedLink : metadataLink;
  const expiresAt = link?.expiresAt ? new Date(String(link.expiresAt)) : null;
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    void systemLog(LogLevel.WARN, "public.payment_link", "payment_link_expired", {
      ...tokenMeta(token),
      tenantId: customer.tenantId,
      expiresAt: expiresAt.toISOString(),
      ip,
      userAgent: req.headers.get("user-agent") || null
    }).catch((err: any) => {
      logger.warn({ err, token, customerId: customer.id, ip }, "Fallo escribiendo systemLog de payment link expired");
    });
    return new Response(JSON.stringify({ error: "expired" }), {
      status: 410,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" }
    });
  }

  const templateId = String(link?.templateId || "").trim();
  let template = templateId ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } }) : null;
  const tenantFromLink = String(link?.tenantId || "").trim();
  if (!template && (tenantFromLink || customer.tenantId)) {
    template = await prisma.publicCheckoutTemplate.findFirst({
      where: {
        tenantId: tenantFromLink || customer.tenantId,
        active: true,
        kind: "PLAN"
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  const tenant = await getTenantBrand(template?.tenantId || tenantFromLink || customer.tenantId || null);

  return new Response(
    JSON.stringify({
      ok: true,
      checkoutUrl: String(link?.checkoutUrl || paymentFromToken?.checkoutUrl || ""),
      amountInCents: Number(link?.amountInCents || paymentFromToken?.amountInCents || 0) || null,
      currency: String(link?.currency || paymentFromToken?.currency || "COP"),
      customer: {
        id: customer.id,
        name: customer.name || "",
        email: customer.email || "",
        phone: customer.phone || ""
      },
      tenant,
      template: template
        ? {
            id: template.id,
            name: template.name,
            kind: template.kind,
            logoUrl: template.logoUrl || null,
            publicTitle: template.publicTitle || null,
            publicDescription: template.publicDescription || null,
            wompiTitle: template.wompiTitle || null,
            wompiDescription: template.wompiDescription || null,
            layout: template.layout || null
          }
        : null
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}
