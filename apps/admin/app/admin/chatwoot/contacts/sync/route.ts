import { z } from "zod";
import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { syncChatwootAttributesForCustomer } from "@suscripciones/core/services/chatwootSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const syncSchema = z.object({
  customerId: z.string().min(1)
});

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const result = await syncChatwootAttributesForCustomer(parsed.data.customerId);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  return Response.json({ contactId: result.contactId, sourceId: result.sourceId, skipped: result.skipped ?? false });
}
