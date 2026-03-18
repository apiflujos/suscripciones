import { prisma } from "@suscripciones/database";
import { LogLevel } from "@prisma/client";
import { getTenantBrand } from "@suscripciones/core/services/tenantBrand";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { tokenMeta } from "@suscripciones/core/lib/tokenMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenizationLinkMeta = {
  token?: string;
  expiresAt?: string;
  usedAt?: string;
  templateId?: string;
  planId?: string;
  kind?: string;
  tenantId?: string;
};

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;
  const token = String(params?.token || "").trim();
  if (!token) return Response.json({ error: "missing_token" }, { status: 400 });

  const ip = String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim();

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: token } as any }
  });
  if (!customer) {
    void systemLog(LogLevel.WARN, "public.tokenization_link", "tokenization_token_not_found", {
      ...tokenMeta(token),
      ip,
      userAgent: req.headers.get("user-agent") || null
    }).catch(() => {});
    return new Response(JSON.stringify({ error: "token_not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" }
    });
  }

  const meta = (customer.metadata ?? {}) as { tokenizationLink?: TokenizationLinkMeta };
  const link = meta?.tokenizationLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  const usedAt = link?.usedAt ? new Date(link.usedAt) : null;

  const allowUsed = String(new URL(req.url).searchParams.get("allowUsed") || "").trim() === "1";
  if (usedAt && !allowUsed) {
    void systemLog(LogLevel.WARN, "public.tokenization_link", "tokenization_token_used", {
      ...tokenMeta(token),
      customerId: customer.id,
      customerName: customer.name || null,
      customerEmail: customer.email || null,
      customerPhone: customer.phone || null,
      tenantId: customer.tenantId,
      planId: link?.planId || null,
      templateId: link?.templateId || null,
      kind: link?.kind || null,
      usedAt: usedAt.toISOString(),
      ip,
      userAgent: req.headers.get("user-agent") || null
    }).catch(() => {});
    return new Response(JSON.stringify({ error: "token_used" }), {
      status: 410,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" }
    });
  }
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    void systemLog(LogLevel.WARN, "public.tokenization_link", "tokenization_token_expired", {
      ...tokenMeta(token),
      customerId: customer.id,
      customerName: customer.name || null,
      customerEmail: customer.email || null,
      customerPhone: customer.phone || null,
      tenantId: customer.tenantId,
      planId: link?.planId || null,
      templateId: link?.templateId || null,
      kind: link?.kind || null,
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

  const tenantFromLink = link?.tenantId ? String(link.tenantId) : null;
  const tenant = await getTenantBrand(template?.tenantId || tenantFromLink || customer.tenantId || null);

  return new Response(
    JSON.stringify({
      ok: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email
      },
      tenant,
      link: {
        planId: link?.planId || null,
        kind: link?.kind || null,
        templateId: link?.templateId || null,
        usedAt: usedAt ? usedAt.toISOString() : null
      },
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
        : null,
      expiresAt: expiresAt ? expiresAt.toISOString() : null
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}
