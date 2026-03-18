import { requireAdminToken } from "../../_lib/requireAdminToken";
import { deleteShopifySettings, updateShopifySettings } from "../../_services/settingsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const out = await updateShopifySettings(body);
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details, message: (out as any).message }, { status: out.status });
  return Response.json(out);
}

export async function DELETE(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const out = await deleteShopifySettings();
  if (!out.ok) return Response.json({ error: out.error, message: (out as any).message }, { status: out.status });
  return Response.json(out);
}
