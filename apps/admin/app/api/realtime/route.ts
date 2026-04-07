import { NextRequest } from "next/server";
import { requireApiSession } from "../_lib/requireApiSession";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";
import { getRolePermissions, hasPermissions, type Permission } from "../../../lib/rbac";
import { subscribeToChannel } from "../../../lib/wsHub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL_PERMS: Record<string, Permission[]> = {
  notifications: ["notifications:read"],
  payments: ["payments:read"],
  logs: ["audit:read"],
  jobs: ["logs:read"]
};

export async function GET(req: NextRequest) {
  const channel = String(req.nextUrl.searchParams.get("channel") || "notifications").trim() || "notifications";
  const required = CHANNEL_PERMS[channel] || [];

  const cookieToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = cookieToken ? await verifyAdminSessionToken(cookieToken) : null;

  if (session) {
    const granted = getRolePermissions(session.role);
    if (required.length && !hasPermissions(required, granted)) {
      return Response.json({ error: "forbidden", reason: "missing_permissions" }, { status: 403 });
    }
  } else {
    const auth = await requireApiSession(req);
    if (!auth.ok) return auth.response;
    if (required.length && !hasPermissions(required, auth.session.permissions as Permission[])) {
      return Response.json({ error: "forbidden", reason: "missing_permissions" }, { status: 403 });
    }
  }

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: string, payload: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}
data: ${JSON.stringify(payload)}

`));
      };

      write("ready", { ok: true, channel, ts: new Date().toISOString() });

      unsubscribe = subscribeToChannel(channel, (payload) => {
        write("message", { channel, payload, ts: new Date().toISOString() });
      });

      heartbeat = setInterval(() => {
        write("ping", { ts: new Date().toISOString() });
      }, 15000);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
