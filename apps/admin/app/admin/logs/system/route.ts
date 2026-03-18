import { requireAdminToken } from "../../_lib/requireAdminToken";
import { listSystemLogs } from "../../_services/logs";

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

  const result = await listSystemLogs({
    withCount,
    take: Number(url.searchParams.get("take") ?? 20),
    skip: Number(url.searchParams.get("skip") ?? 0),
    q: url.searchParams.get("q") ?? "",
    level: url.searchParams.get("level") ?? "",
    customerId: url.searchParams.get("customerId") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    ids
  });
  return Response.json({ items: result.items, total: result.total });
}
