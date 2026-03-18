import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { Prisma, PublicCheckoutKind } from "@prisma/client";
import { requireAdminToken } from "../_lib/requireAdminToken";
import { reqToCompat } from "../_lib/reqCompat";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { listCheckoutTemplates } from "../_services/checkoutTemplates";

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
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return v;
}, z.array(z.string()).optional());

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

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const compatReq = reqToCompat(req);
  const url = new URL(req.url);
  const rawTenant = String(
    url.searchParams.get("tenantId") || (compatReq as any)?.body?.tenantId || req.headers.get("x-tenant-id") || ""
  ).trim();
  const wantsAll = rawTenant.toLowerCase() === "all";
  const tenantId = wantsAll ? null : await getEffectiveTenantId(compatReq);
  const items = await listCheckoutTemplates({ tenantId, wantsAll });
  return Response.json({ items });
}

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = templateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const hasProducts = Array.isArray(data.productIds) && data.productIds.length > 0;
  if (!data.allowProductSelect && !hasProducts) {
    return Response.json({ error: "product_required" }, { status: 400 });
  }
  if (String(data.kind) === "CART" && data.productIds?.length) {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { id: { in: data.productIds } },
      select: { id: true, metadata: true }
    });
    let hasPlan = false;
    let hasSub = false;
    for (const p of plans) {
      const mode = String((p.metadata as any)?.collectionMode || "");
      if (!mode || mode === "AUTO_LINK") hasPlan = true;
      if (mode === "AUTO_DEBIT") hasSub = true;
      if (hasPlan && hasSub) break;
    }
    if (hasPlan && hasSub) {
      return Response.json({ error: "cart_mixed_collection" }, { status: 400 });
    }
  }

  const compatReq = reqToCompat(req, body);
  const tenantId = await getEffectiveTenantId(compatReq);
  if (!tenantId) return Response.json({ error: "tenant_required" }, { status: 400 });

  const created = await prisma.publicCheckoutTemplate.create({
    data: {
      tenantId,
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

  return Response.json({ template: created }, { status: 201 });
}
