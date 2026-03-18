import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { recollectPayments } from "../../../_services/logsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const daysRaw = url.searchParams.get("days");
  const takeRaw = url.searchParams.get("take");
  const daysNum = daysRaw ? Number(daysRaw) : NaN;
  const takeNum = takeRaw ? Number(takeRaw) : NaN;
  const out = await recollectPayments({
    days: Number.isFinite(daysNum) ? daysNum : undefined,
    take: Number.isFinite(takeNum) ? takeNum : undefined
  });
  return Response.json(out);
}
