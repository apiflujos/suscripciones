import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { getClientOrThrow } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listCustomAttrsSchema = z.object({
  model: z.enum(["contact", "conversation"])
});

const createCustomAttrSchema = z.object({
  displayName: z.string().min(1),
  key: z.string().min(1),
  displayType: z.union([
    z.enum(["text", "number", "currency", "boolean", "url", "date", "list", "percent", "checkbox"]),
    z.number().int()
  ]),
  model: z.union([z.enum(["contact", "conversation"]), z.number().int()]),
  values: z.array(z.string().min(1)).optional(),
  description: z.string().min(1).optional(),
  regexPattern: z.string().min(1).optional(),
  regexCue: z.string().min(1).optional()
});

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const parsed = listCustomAttrsSchema.safeParse({ model: String(url.searchParams.get("model") || "").trim() });
  if (!parsed.success) return Response.json({ error: "invalid_query", details: parsed.error.flatten() }, { status: 400 });

  const client = await getClientOrThrow().catch((err) => ({ error: err?.message || "chatwoot_not_configured" } as any));
  if ((client as any)?.error) return Response.json({ error: (client as any).error }, { status: 400 });

  const out = await (client as any).listCustomAttributes(parsed.data.model);
  return Response.json(out.raw);
}

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createCustomAttrSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const client = await getClientOrThrow().catch((err) => ({ error: err?.message || "chatwoot_not_configured" } as any));
  if ((client as any)?.error) return Response.json({ error: (client as any).error }, { status: 400 });

  const out = await (client as any).createCustomAttribute(parsed.data);
  return Response.json(out.raw, { status: 201 });
}
