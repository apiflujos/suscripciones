import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { WompiClient } from "@suscripciones/core/providers/wompi/client";
import {
  getWompiApiBaseUrl,
  getWompiCheckoutLinkBaseUrl,
  getWompiPrivateKey,
  getWompiPublicKey
} from "@suscripciones/core/services/runtimeConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const wompiPaymentSourceSchema = z.object({
  type: z.enum(["CARD", "NEQUI", "PSE"]).default("CARD"),
  token: z.string().min(1)
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const customerId = String(params?.id || "").trim();
  const body = await req.json().catch(() => null);
  const parsed = wompiPaymentSourceSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return Response.json({ error: "customer_not_found" }, { status: 404 });
  if (!customer.email) return Response.json({ error: "customer_email_required" }, { status: 400 });

  const publicKey = await getWompiPublicKey();
  if (!publicKey) return Response.json({ error: "wompi_public_key_not_configured" }, { status: 400 });
  const privateKey = await getWompiPrivateKey();
  if (!privateKey) return Response.json({ error: "wompi_private_key_not_configured" }, { status: 400 });

  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey, checkoutLinkBaseUrl });
  const merchant = await wompi.getMerchant(publicKey);

  const created = await wompi.createPaymentSource({
    type: parsed.data.type,
    token: parsed.data.token,
    customer_email: customer.email,
    acceptance_token: merchant.acceptanceToken,
    accept_personal_auth: merchant.acceptPersonalAuth
  });

  const existing = (customer.metadata ?? {}) as any;
  const existingWompi = existing?.wompi && typeof existing.wompi === "object" ? existing.wompi : {};
  const existingSources = Array.isArray(existingWompi?.paymentSources) ? existingWompi.paymentSources : [];
  const nextSources = [
    ...existingSources.filter((s: any) => Number(s?.id) !== created.id),
    { id: created.id, type: parsed.data.type, createdAt: new Date().toISOString() }
  ];
  const merged = {
    ...(existing && typeof existing === "object" ? existing : {}),
    wompi: {
      ...(existingWompi || {}),
      paymentSourceId: created.id,
      paymentSourceType: parsed.data.type,
      paymentSources: nextSources,
      acceptancePermalink: merchant.acceptancePermalink,
      personalDataPermalink: merchant.personalDataPermalink,
      createdAt: new Date().toISOString()
    }
  };

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { metadata: merged as any }
  });

  return Response.json({ customer: updated, paymentSourceId: created.id }, { status: 201 });
}
