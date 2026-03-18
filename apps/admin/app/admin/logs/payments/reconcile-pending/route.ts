import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reconcilePendingPayments } from "../../../_services/logsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const body = await req.json().catch(() => null);
  const out = await reconcilePendingPayments({
    minutes: url.searchParams.get("minutes") ?? body?.minutes,
    take: url.searchParams.get("take") ?? body?.take,
    tenantId: url.searchParams.get("tenantId") ?? body?.tenantId
  });
  return Response.json(out);
}
