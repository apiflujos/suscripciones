import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { getCommerceReport } from "@suscripciones/core/services/reports";
import { coerceTenantId, getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { defaultRange, normalizeCacheRange, parseQueryDate, querySchema, respondWithCache } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    granularity: url.searchParams.get("granularity") ?? undefined,
    tenantId: url.searchParams.get("tenantId") ?? undefined
  });
  if (!parsed.success) return Response.json({ error: "invalid_query", details: parsed.error.flatten() }, { status: 400 });

  const d = defaultRange();
  const from = parsed.data.from ? parseQueryDate(parsed.data.from) || d.from : d.from;
  const to = parsed.data.to ? parseQueryDate(parsed.data.to) || d.to : d.to;
  const hasExplicitRange = Boolean(parsed.data.from || parsed.data.to);
  const ttlSeconds = 300;
  const staleSeconds = 900;
  const cacheRange = normalizeCacheRange(from, to, ttlSeconds, hasExplicitRange);
  const compatReq = reqToCompat(req);
  const tenantId = coerceTenantId(parsed.data.tenantId) ?? (await getEffectiveTenantId(compatReq as any)) ?? null;
  if (!tenantId) {
    const payload = await getCommerceReport({
      from: cacheRange.from,
      to: cacheRange.to,
      granularity: parsed.data.granularity,
      tenantId: null
    });
    return Response.json(payload);
  }

  const key = {
    reportKey: "reports.commerce",
    tenantId,
    from: cacheRange.from,
    to: cacheRange.to,
    granularity: parsed.data.granularity,
    version: "v1"
  };
  return respondWithCache(key, ttlSeconds, staleSeconds, () =>
    getCommerceReport({
      from: cacheRange.from,
      to: cacheRange.to,
      granularity: parsed.data.granularity,
      tenantId
    })
  );
}
