import { requireAdminToken } from "../../_lib/requireAdminToken";
import { metricsQuerySchema, getMetricsOverviewCached } from "../../_services/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const parsed = metricsQuerySchema.safeParse({
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    granularity: url.searchParams.get("granularity") || undefined,
    tenantId: url.searchParams.get("tenantId") || undefined
  });
  if (!parsed.success) {
    console.log("[Metrics] Invalid query params", { errors: parsed.error.flatten() });
    return Response.json({ error: "invalid_query", details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await getMetricsOverviewCached({
    from: parsed.data.from,
    to: parsed.data.to,
    granularity: parsed.data.granularity,
    tenantId: parsed.data.tenantId || null
  });
  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        message: result.message,
        details: result.details
      },
      { status: result.status }
    );
  }
  const headers = result.cache === "BYPASS" ? undefined : { "x-report-cache": result.cache };
  return Response.json(result.data, { headers });
}
