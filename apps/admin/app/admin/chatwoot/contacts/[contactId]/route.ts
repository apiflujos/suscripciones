import { z } from "zod";
import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { getClientOrThrow } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateContactSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().min(4).optional(),
  identifier: z.string().min(1).optional(),
  additionalAttributes: z.record(z.any()).optional(),
  customAttributes: z.record(z.any()).optional()
});

export async function PUT(req: Request, ctx: { params: Promise<{ contactId: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const contactId = Number(params?.contactId);
  if (!Number.isFinite(contactId)) return Response.json({ error: "invalid_contact_id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = updateContactSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const client = await getClientOrThrow().catch((err) => {
    return { error: err?.message || "chatwoot_not_configured" } as any;
  });
  if ((client as any)?.error) return Response.json({ error: (client as any).error }, { status: 400 });

  const updated = await (client as any).updateContact(contactId, parsed.data);
  return Response.json({ ok: true, raw: updated.raw });
}
