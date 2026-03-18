import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { createAdminUser, listAdminUsers } from "../../_services/adminUsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getRequestingUser(req: Request) {
  const email = String(req.headers.get("x-admin-user-email") || "").trim().toLowerCase();
  if (!email) return null;
  return await prisma.saUser.findUnique({ where: { email } });
}

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const requester = await getRequestingUser(req);
  const out = await listAdminUsers(requester);
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json({ items: out.items });
}

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const requester = await getRequestingUser(req);
  const out = await createAdminUser(requester, body);
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details }, { status: out.status });
  return Response.json(out.user, { status: 201 });
}
