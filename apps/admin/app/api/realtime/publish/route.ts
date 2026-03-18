import { requireApiSession } from "../../_lib/requireApiSession";
import { publishToChannel } from "../../../../lib/wsHub";

const CHANNEL_PERMS: Record<string, string[]> = {
  notifications: ["notifications:write"],
  payments: ["payments:write"],
  logs: ["audit:read"],
  jobs: ["logs:read"]
};

export async function POST(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const channel = String(body?.channel || "").trim();
  if (!channel) return new Response(JSON.stringify({ error: "missing_channel" }), { status: 400 });
  const required = CHANNEL_PERMS[channel] || [];
  if (required.length && !required.every((p) => auth.session.permissions.includes(p))) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const payload = body?.payload ?? {};
  const delivered = publishToChannel(channel, payload);

  return new Response(JSON.stringify({ ok: true, delivered }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
