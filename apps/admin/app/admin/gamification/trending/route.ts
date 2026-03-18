import { requireAdminToken } from "../../_lib/requireAdminToken";
import { listGamificationTrending } from "../../_services/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || undefined;
  const hoursRaw = url.searchParams.get("windowHours") ?? url.searchParams.get("hours");
  const hoursNum = hoursRaw ? Number(hoursRaw) : NaN;
  const out = await listGamificationTrending({
    tenantId: url.searchParams.get("tenantId"),
    scope,
    hours: Number.isFinite(hoursNum) ? hoursNum : undefined
  });
  return Response.json(out);
}
