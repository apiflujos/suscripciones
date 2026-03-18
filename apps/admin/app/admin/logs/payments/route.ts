import { requireAdminToken } from "../../_lib/requireAdminToken";
import { listPaymentLogs } from "../../_services/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const withCount = String(url.searchParams.get("count") ?? "") === "1";
  const idsParam = url.searchParams.get("ids");
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw
    ? idsRaw
        .split(",")
        .map((v) => v.trim())
        .filter((v) => /^[0-9a-fA-F-]{36}$/.test(v))
    : [];

  const result = await listPaymentLogs({
    withCount,
    take: Number(url.searchParams.get("take") ?? 20),
    skip: Number(url.searchParams.get("skip") ?? 0),
    q: url.searchParams.get("q") ?? "",
    ids,
    status: url.searchParams.get("status") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    tenantId: url.searchParams.get("tenantId") ?? "",
    planId: url.searchParams.get("planId") ?? "",
    includeIgnored: ["1", "true", "yes", "on"].includes(String(url.searchParams.get("includeIgnored") ?? "").trim().toLowerCase())
  });
  return Response.json({ items: result.items, total: result.total });
}
