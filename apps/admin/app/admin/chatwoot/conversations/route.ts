import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { getClientOrThrow } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const conversationCreateSchema = z.object({
  contactId: z.number().int().positive(),
  sourceId: z.string().min(1).optional(),
  message: z.string().min(1).optional()
});

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = conversationCreateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const client = await getClientOrThrow().catch((err) => ({ error: err?.message || "chatwoot_not_configured" } as any));
  if ((client as any)?.error) return Response.json({ error: (client as any).error }, { status: 400 });

  try {
    const created = await (client as any).createConversation(parsed.data);
    return Response.json(created, { status: 201 });
  } catch (err: any) {
    return Response.json(
      { error: "chatwoot_create_conversation_failed", details: err?.message || "unknown_error" },
      { status: 502 }
    );
  }
}
