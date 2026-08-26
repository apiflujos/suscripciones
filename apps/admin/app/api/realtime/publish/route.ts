import { requireApiSession } from "../../_lib/requireApiSession";
import { publishToChannel } from "../../../../lib/wsHub";
import { detallesDeError, publicarTiempoRealSchema, type CanalTiempoReal } from "../../_lib/bodySchemas";

const CHANNEL_PERMS: Record<CanalTiempoReal, string[]> = {
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

  const parsed = publicarTiempoRealSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "invalid_payload", detalles: detallesDeError(parsed.error) }),
      { status: 400 }
    );
  }
  const { channel } = parsed.data;

  // El canal ya está en la lista por el enum del esquema, así que aquí SIEMPRE
  // hay permisos que exigir. Antes, un canal fuera del mapa dejaba `required`
  // vacío y este chequeo se saltaba entero.
  const required = CHANNEL_PERMS[channel];
  if (!required.every((p) => auth.session.permissions.includes(p))) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const payload = parsed.data.payload;
  const delivered = publishToChannel(channel, payload);

  return new Response(JSON.stringify({ ok: true, delivered }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
