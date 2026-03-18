import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { coerceTenantId, getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { queueAiAssistRequest } from "../../_services/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const askSchema = z.object({
  question: z.string().min(3).max(2000),
  from: z.string().optional(),
  to: z.string().optional(),
  tenantId: z.string().optional(),
  customerId: z.string().optional(),
  productId: z.string().optional(),
  scope: z.string().optional()
});

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = askSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const tenantId =
    coerceTenantId(parsed.data.tenantId) ??
    (await getEffectiveTenantId(reqToCompat(req, parsed.data))) ??
    null;
  const result = await queueAiAssistRequest({
    question: parsed.data.question,
    from: parsed.data.from || null,
    to: parsed.data.to || null,
    tenantId: tenantId || null,
    customerId: parsed.data.customerId || null,
    productId: parsed.data.productId || null,
    scope: parsed.data.scope || null
  });
  if (!result.ok) {
    return Response.json({ error: result.error, reason: result.reason }, { status: result.status });
  }

  return Response.json({ requestId: result.requestId });
}
