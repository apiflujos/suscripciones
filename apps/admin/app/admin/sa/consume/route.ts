import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { requireSaSession } from "../../_lib/requireSaSession";
import { consumeLimitOrBlock } from "@suscripciones/core/services/superAdminConsume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const consumeSchema = z.object({
  tenantId: z.string().uuid(),
  serviceKey: z.string().min(1),
  amount: z.number().int().positive().optional().default(1),
  source: z.string().optional(),
  meta: z.any().optional()
});

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const body = await req.json().catch(() => null);
  const parsed = consumeSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const out = await consumeLimitOrBlock(parsed.data.serviceKey, {
      tenantId: parsed.data.tenantId,
      amount: parsed.data.amount,
      source: parsed.data.source,
      meta: parsed.data.meta
    });
    return Response.json(out);
  } catch (err: any) {
    return Response.json({ error: err?.message ? String(err.message) : "consume_failed" }, { status: 400 });
  }
}
