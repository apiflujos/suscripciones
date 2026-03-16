import { getRequiredApiBase } from "../../../lib/adminApi";
import { normalizeToken } from "../../../lib/normalizeToken";

export async function GET(req: Request) {
  const API_BASE = getRequiredApiBase();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return new Response(JSON.stringify({ error: "missing_admin_token" }), { status: 401 });

  const url = new URL(req.url);
  const take = url.searchParams.get("take") || "10";

  const res = await fetch(`${API_BASE}/admin/ai/history?take=${encodeURIComponent(take)}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => ({}));
  return new Response(JSON.stringify(json), {
    status: res.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
