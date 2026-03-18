import { requireAdminToken } from "../_lib/requireAdminToken";
import { listWebhookEvents } from "../_services/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const withCount = String(url.searchParams.get("count") ?? "") === "1";
  const take = Number(url.searchParams.get("take") ?? 20);
  const skip = Number(url.searchParams.get("skip") ?? 0);
  const q = String(url.searchParams.get("q") ?? "").trim();
  const processStatus = String(url.searchParams.get("processStatus") ?? "").trim();
  const from = String(url.searchParams.get("from") ?? "").trim();
  const to = String(url.searchParams.get("to") ?? "").trim();
  const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();

  const out = await listWebhookEvents({ take, skip, q, processStatus, from, to, tenantId, withCount });
  return Response.json(out);
}
