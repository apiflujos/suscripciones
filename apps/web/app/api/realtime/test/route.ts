import { getRequiredApiBase } from "../../../lib/adminApi";
import { normalizeToken } from "../../../lib/normalizeToken";

export async function POST() {
  const API_BASE = getRequiredApiBase();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return new Response("missing_admin_token", { status: 401 });

  const res = await fetch(`${API_BASE}/admin/logs/system/test`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token, "content-type": "application/json" },
    cache: "no-store"
  });
  if (!res.ok) return new Response("test_failed", { status: res.status });
  return new Response("ok", { status: 200 });
}
