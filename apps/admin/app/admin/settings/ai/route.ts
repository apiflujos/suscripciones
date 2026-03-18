import { requireAdminToken } from "../../_lib/requireAdminToken";
import { deleteAiProvider, updateAiProvider } from "../../_services/settingsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const out = await updateAiProvider(body);
  if (!out.ok) return Response.json({ error: out.error, reason: (out as any).reason, details: (out as any).details }, { status: out.status });
  return Response.json(out);
}

export async function DELETE(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const out = await deleteAiProvider(body);
  if (!out.ok) return Response.json({ error: out.error, reason: (out as any).reason, details: (out as any).details }, { status: out.status });
  return Response.json(out);
}
