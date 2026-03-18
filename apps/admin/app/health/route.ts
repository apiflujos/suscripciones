import { prisma } from "@suscripciones/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readiness probe (requires DB connectivity)
export async function GET() {
  await prisma.$queryRaw`SELECT 1`;
  return Response.json({ ok: true });
}
