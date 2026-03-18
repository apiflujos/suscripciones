import { prisma } from "@suscripciones/database";
import { Prisma } from "@prisma/client";
import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { getNotificationsConfig } from "@suscripciones/core/services/notificationsConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const subscriptionId = String(url.searchParams.get("subscriptionId") ?? "").trim() || null;
  const customerId = String(url.searchParams.get("customerId") ?? "").trim() || null;
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));

  const where: Prisma.RetryJobWhereInput = {
    type: "SUBSCRIPTION_REMINDER",
    status: { in: ["PENDING", "RUNNING"] }
  };
  if (subscriptionId) {
    where.payload = { path: ["subscriptionId"], equals: subscriptionId } as any;
  }

  const jobs = await prisma.retryJob.findMany({
    where,
    orderBy: { runAt: "asc" },
    take: limit,
    select: {
      id: true,
      status: true,
      runAt: true,
      attempts: true,
      maxAttempts: true,
      payload: true,
      lastError: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const enriched = await Promise.all(
    jobs.map(async (job) => {
      const payload: any = job.payload || {};
      const subId = payload.subscriptionId;
      const custId = payload.customerId || customerId;

      const [subscription, customer] = await Promise.all([
        subId
          ? prisma.subscription.findUnique({
              where: { id: subId },
              select: {
                id: true,
                status: true,
                currentCycle: true,
                currentPeriodEndAt: true,
                customer: { select: { id: true, name: true, email: true } }
              }
            })
          : Promise.resolve(null),
        custId
          ? prisma.customer.findUnique({
              where: { id: custId },
              select: { id: true, name: true, email: true }
            })
          : Promise.resolve(null)
      ]);

      const cfg = await getNotificationsConfig();
      const rulesCount = cfg.rules.filter((r) => r.enabled && r.trigger === "SUBSCRIPTION_DUE").length;

      return {
        ...job,
        _enriched: {
          subscription: subscription
            ? {
                id: subscription.id,
                status: subscription.status,
                currentCycle: subscription.currentCycle,
                currentPeriodEndAt: subscription.currentPeriodEndAt.toISOString(),
                customer: subscription.customer
              }
            : null,
          customer: customer || null,
          rulesConfigured: rulesCount > 0,
          rulesCount,
          payloadCycle: payload.cycleNumber,
          anchorAt: payload.anchorAt,
          offsetSeconds: payload.offsetSeconds,
          trigger: payload.trigger,
          ruleId: payload.ruleId
        }
      };
    })
  );

  return Response.json({
    jobs: enriched,
    total: jobs.length,
    hasMore: jobs.length >= limit
  });
}
