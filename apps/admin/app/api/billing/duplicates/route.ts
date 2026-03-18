import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { prisma } from "@suscripciones/database";

const ACTIVE_STATUSES = new Set(["ACTIVE", "PAST_DUE", "SUSPENDED", "EXPIRED"]);

export async function GET(req: NextRequest) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const customerId = String(url.searchParams.get("customerId") || "").trim();
  const productId = String(url.searchParams.get("productId") || "").trim();
  const tenantId = String(url.searchParams.get("tenantId") || "").trim();
  if (!customerId || !productId) return NextResponse.json({ duplicatesCount: 0, items: [] });

  const effectiveTenantId = tenantId || auth.session.tenantId || "";
  const where: any = {
    customerId,
    status: { in: Array.from(ACTIVE_STATUSES) as any }
  };
  if (effectiveTenantId) {
    where.AND = [{ OR: [{ tenantId: effectiveTenantId }, { tenantLinks: { some: { tenantId: effectiveTenantId } } }] }];
  }

  const items = await prisma.subscription.findMany({
    where,
    take: 300,
    include: { plan: true, tenantLinks: true }
  });
  const duplicates = items
    .filter((s: any) => String(s?.plan?.metadata?.catalog?.itemId || "").trim() === productId)
    .map((s: any) => ({
      id: String(s?.id || ""),
      status: String(s?.status || ""),
      planId: String(s?.planId || s?.plan?.id || ""),
      planName: String(s?.plan?.name || "")
    }))
    .filter((s: any) => s.id);

  return NextResponse.json({ duplicatesCount: duplicates.length, items: duplicates });
}
