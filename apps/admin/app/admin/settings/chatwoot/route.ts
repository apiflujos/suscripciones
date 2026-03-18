import { requireAdminToken } from "../../_lib/requireAdminToken";
import { deleteChatwootSettings, updateChatwootSettings } from "../../_services/settingsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const out = await updateChatwootSettings(body);
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details, message: (out as any).message }, { status: out.status });
  return Response.json(out);
}

export async function DELETE(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const out = await deleteChatwootSettings(body);
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details, message: (out as any).message }, { status: out.status });
  return Response.json(out);
}
