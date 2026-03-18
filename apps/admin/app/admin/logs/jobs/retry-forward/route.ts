import { prisma } from "@suscripciones/database";
import { RetryJobStatus } from "@prisma/client";
import { requireAdminToken } from "../../../_lib/requireAdminToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const result = await prisma.retryJob.updateMany({
    where: { status: RetryJobStatus.FAILED, type: "FORWARD_WOMPI_TO_SHOPIFY" },
    data: { status: RetryJobStatus.PENDING, runAt: now, lockedAt: null, lockedBy: null }
  });
  return Response.json({ ok: true, retried: result.count });
}
