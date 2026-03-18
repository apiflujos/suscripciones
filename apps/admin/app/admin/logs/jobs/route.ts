import { requireAdminToken } from "../../_lib/requireAdminToken";
import { listRetryJobs } from "../../_services/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const withCount = String(url.searchParams.get("count") ?? "") === "1";
  const take = Number(url.searchParams.get("take") ?? 20);
  const skip = Number(url.searchParams.get("skip") ?? 0);
  const from = String(url.searchParams.get("from") ?? "").trim();
  const to = String(url.searchParams.get("to") ?? "").trim();

  const out = await listRetryJobs({ take, skip, from, to, withCount });
  return Response.json(out);
}
