import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reconcilePendingPayments } from "../../../_services/logsActions";
import { detallesDeError, reconciliarPendientesSchema } from "../../../../api/_lib/bodySchemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const body = await req.json().catch(() => null);
  const parsed = reconciliarPendientesSchema.safeParse({
    minutes: url.searchParams.get("minutes") ?? (body as any)?.minutes,
    take: url.searchParams.get("take") ?? (body as any)?.take,
    tenantId: url.searchParams.get("tenantId") ?? (body as any)?.tenantId
  });
  if (!parsed.success) {
    return Response.json({ error: "parametros_invalidos", detalles: detallesDeError(parsed.error) }, { status: 400 });
  }
  const out = await reconcilePendingPayments({
    minutes: parsed.data.minutes ?? undefined,
    take: parsed.data.take ?? undefined,
    tenantId: parsed.data.tenantId ?? undefined
  });
  return Response.json(out);
}
