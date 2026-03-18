import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { getClientOrThrow } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createContactSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().min(4).optional(),
  identifier: z.string().min(1).optional(),
  additionalAttributes: z.record(z.any()).optional(),
  customAttributes: z.record(z.any()).optional()
});

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createContactSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const client = await getClientOrThrow().catch((err) => {
    return { error: err?.message || "chatwoot_not_configured" } as any;
  });
  if ((client as any)?.error) return Response.json({ error: (client as any).error }, { status: 400 });

  const created = await (client as any).createContact({
    name: parsed.data.name,
    email: parsed.data.email,
    phoneNumber: parsed.data.phoneNumber
  });
  if (parsed.data.identifier || parsed.data.additionalAttributes || parsed.data.customAttributes) {
    await (client as any).updateContact(created.contactId, {
      identifier: parsed.data.identifier,
      additionalAttributes: parsed.data.additionalAttributes,
      customAttributes: parsed.data.customAttributes
    });
  }
  return Response.json({ contactId: created.contactId, sourceId: created.sourceId, raw: created.raw }, { status: 201 });
}
