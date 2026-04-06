import { prisma } from "@suscripciones/database";
import { getJobsHealth, getPaymentsHealth } from "../admin/_services/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [dbOk, jobs, payments] = await Promise.all([
    prisma.$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false),
    getJobsHealth().catch(() => null),
    getPaymentsHealth().catch(() => null)
  ]);

  const jobsHealthy = Boolean(jobs?.healthy);
  const webhookBacklog = Number(payments?.pendingWebhookEvents || 0);
  const paymentsHealthy = payments ? webhookBacklog === 0 && Number(payments.failedWebhookEvents || 0) === 0 : false;
  const ok = dbOk && jobsHealthy && paymentsHealthy;

  return Response.json(
    {
      ok,
      status: ok ? "up" : "degraded",
      checks: {
        database: dbOk ? "up" : "down",
        jobs: jobs?.status || "unknown",
        payments: paymentsHealthy ? "up" : "degraded"
      },
      jobs,
      payments
    },
    { status: ok ? 200 : 503 }
  );
}
