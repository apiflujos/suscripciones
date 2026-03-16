import { getRequiredApiBase } from "../../../lib/adminApi";
import { normalizeToken } from "../../../lib/normalizeToken";

export async function POST(req: Request) {
  const API_BASE = getRequiredApiBase();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return new Response(JSON.stringify({ error: "missing_admin_token" }), { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 });
  }

  const res = await fetch(`${API_BASE}/admin/ai/ask`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const json = await res.json().catch(() => ({}));
  return new Response(JSON.stringify(json), {
    status: res.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
