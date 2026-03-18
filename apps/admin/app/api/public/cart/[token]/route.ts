import { prisma } from "@suscripciones/database";
import { LogLevel, PlanIntervalUnit } from "@prisma/client";
import { getTenantBrand } from "@suscripciones/core/services/tenantBrand";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { tokenMeta } from "@suscripciones/core/lib/tokenMeta";
import { verifyPublicToken } from "../../../../lib/publicTokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;
  const token = String(params?.token || "").trim();
  if (!token) return Response.json({ error: "missing_token" }, { status: 400 });

  const jwt = await verifyPublicToken(token, "cart");
  if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const ip = String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim();

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["cartLink", "token"], equals: token } as any }
  });
  if (!customer) {
    void systemLog(LogLevel.WARN, "public.cart_link", "cart_token_not_found", {
      ...tokenMeta(token),
      ip,
      userAgent: req.headers.get("user-agent") || null
    }).catch(() => {});
    return new Response(JSON.stringify({ error: "token_not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" }
    });
  }

  const meta = (customer.metadata ?? {}) as { cartLink?: CartLinkMeta };
  const link = meta?.cartLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    void systemLog(LogLevel.WARN, "public.cart_link", "cart_token_expired", {
      ...tokenMeta(token),
      tenantId: customer.tenantId,
      expiresAt: expiresAt.toISOString(),
      ip,
      userAgent: req.headers.get("user-agent") || null
    }).catch(() => {});
    return new Response(JSON.stringify({ error: "token_expired" }), {
      status: 410,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" }
    });
  }

  const templateId = String(link?.templateId || "").trim();
  const template = templateId ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } }) : null;
  if (!template || String(template.kind) !== "CART") {
    void systemLog(LogLevel.WARN, "public.cart_link", "cart_template_not_found", {
      ...tokenMeta(token),
      tenantId: customer.tenantId,
      templateId: templateId || null,
      ip,
      userAgent: req.headers.get("user-agent") || null
    }).catch(() => {});
    return new Response(JSON.stringify({ error: "template_not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" }
    });
  }

  const productIds = Array.isArray(template.productIds)
    ? template.productIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const plans = productIds.length ? await prisma.subscriptionPlan.findMany({ where: { id: { in: productIds } } }) : [];
  const plansTyped = plans as PlanPublic[];

  const tenant = await getTenantBrand(template?.tenantId || customer.tenantId || null);

  return new Response(
    JSON.stringify({
      ok: true,
      customer: {
        id: customer.id,
        name: customer.name || "",
        email: customer.email || "",
        phone: customer.phone || ""
      },
      tenant,
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
      products: plansTyped.map((p) => ({
        id: p.id,
        name: p.name,
        priceInCents: p.priceInCents,
        currency: p.currency,
        intervalUnit: p.intervalUnit,
        intervalCount: p.intervalCount,
        collectionMode: String((p.metadata as PlanMetadata | null)?.collectionMode || "MANUAL_LINK")
      }))
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}
