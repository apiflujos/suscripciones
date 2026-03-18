import { z } from "zod";
import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { getClientOrThrow } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const labelsSchema = z.object({
  labels: z.array(z.string().min(1)).min(1)
});

export async function GET(req: Request, ctx: { params: Promise<{ conversationId: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const conversationId = Number(params?.conversationId);
  if (!Number.isFinite(conversationId)) return Response.json({ error: "invalid_conversation_id" }, { status: 400 });
  const client = await getClientOrThrow().catch((err) => ({ error: err?.message || "chatwoot_not_configured" } as any));
  if ((client as any)?.error) return Response.json({ error: (client as any).error }, { status: 400 });

  const list = await (client as any).listConversationLabels(conversationId);
  return Response.json(list.raw);
}

export async function POST(req: Request, ctx: { params: Promise<{ conversationId: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const conversationId = Number(params?.conversationId);
  if (!Number.isFinite(conversationId)) return Response.json({ error: "invalid_conversation_id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = labelsSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const client = await getClientOrThrow().catch((err) => ({ error: err?.message || "chatwoot_not_configured" } as any));
  if ((client as any)?.error) return Response.json({ error: (client as any).error }, { status: 400 });

  const out = await (client as any).addConversationLabels(conversationId, parsed.data.labels);
  return Response.json(out.raw);
}
