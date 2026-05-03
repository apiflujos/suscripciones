import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { Prisma, PublicCheckoutKind } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const layoutSchema = z
  .object({
    primaryColor: z.string().optional().or(z.literal("")),
    fontFamily: z.string().optional().or(z.literal("")),
    supportEmail: z.string().optional().or(z.literal("")),
    supportUrl: z.string().optional().or(z.literal("")),
    ctaLabel: z.string().optional().or(z.literal("")),
    fields: z
      .object({
        showName: z.boolean().optional(),
        showPhone: z.boolean().optional(),
        showEmail: z.boolean().optional()
      })
      .optional()
  })
  .optional();

const kindSchema = z.preprocess((v) => {
  const s = String(v || "").trim().toUpperCase();
  if (s === "SUBSCRIPCION") return "SUBSCRIPTION";
  return s;
}, z.nativeEnum(PublicCheckoutKind));

const productIdsSchema = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return v;
}, z.array(z.any()).optional());

const templateSchema = z.object({
  name: z.string().min(1),
  kind: kindSchema,
  active: z.boolean().optional(),
  allowProductSelect: z.boolean().optional(),
  productIds: productIdsSchema,
  expiryHours: z.coerce.number().int().positive().optional(),
  logoUrl: z.string().optional().or(z.literal("")),
  publicTitle: z.string().optional().or(z.literal("")),
  publicDescription: z.string().optional().or(z.literal("")),
  wompiTitle: z.string().optional().or(z.literal("")),
  wompiDescription: z.string().optional().or(z.literal("")),
  utmParams: z.string().optional().or(z.literal("")),
  layout: layoutSchema
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  if (!id) return Response.json({ error: "invalid_id" }, { status: 400 });

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  const item = await prisma.publicCheckoutTemplate.findUnique({ where: { id } });
  if (!item) return Response.json({ error: "not_found" }, { status: 404 });
  if (tenantId && item.tenantId && item.tenantId !== tenantId) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ item });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  if (!id) return Response.json({ error: "invalid_id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = templateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const hasProducts = Array.isArray(data.productIds) && data.productIds.length > 0;
  if (!hasProducts) {
    return Response.json({ error: "product_required" }, { status: 400 });
  }
  if (data.kind !== PublicCheckoutKind.CART && Array.isArray(data.productIds) && data.productIds.length > 1) {
    return Response.json({ error: "max_one_product" }, { status: 400 });
  }

  const compatReq = reqToCompat(req, body);
  const tenantId = await getEffectiveTenantId(compatReq);
  if (tenantId) {
    const existing = await prisma.publicCheckoutTemplate.findUnique({ where: { id } });
    if (!existing || (existing.tenantId && existing.tenantId !== tenantId)) return Response.json({ error: "not_found" }, { status: 404 });
  }
  const updated = await prisma.publicCheckoutTemplate.update({
    where: { id },
    data: {
      name: data.name,
      kind: data.kind,
      active: data.active ?? true,
      allowProductSelect: data.allowProductSelect ?? false,
      productIds: data.productIds || [],
      expiryHours: data.expiryHours ?? null,
      logoUrl: data.logoUrl || null,
      publicTitle: data.publicTitle || null,
      publicDescription: data.publicDescription || null,
      wompiTitle: data.wompiTitle || null,
      wompiDescription: data.wompiDescription || null,
      utmParams: data.utmParams || null,
      layout: data.layout ?? Prisma.JsonNull
    }
  });
  return Response.json({ template: updated });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  if (!id) return Response.json({ error: "invalid_id" }, { status: 400 });

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  if (tenantId) {
    const existing = await prisma.publicCheckoutTemplate.findUnique({ where: { id } });
    if (!existing || (existing.tenantId && existing.tenantId !== tenantId)) return Response.json({ error: "not_found" }, { status: 404 });
  }
  await prisma.publicCheckoutTemplate.delete({ where: { id } });
  return Response.json({ ok: true });
}
