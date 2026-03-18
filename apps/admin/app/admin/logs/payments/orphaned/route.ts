import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../_lib/requireAdminToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const daysOld = Math.max(1, Number(url.searchParams.get("days") ?? 30));
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

  const orphanPayments = await prisma.payment.findMany({
    where: {
      subscriptionId: null,
      createdAt: { lt: cutoffDate }
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      customerId: true,
      amountInCents: true,
      currency: true,
      status: true,
      wompiTransactionId: true,
      wompiPaymentLinkId: true,
      reference: true,
      createdAt: true,
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          createdAt: true,
          _count: {
            select: {
              payments: true,
              subscriptions: true
            }
          }
        }
      }
    }
  });

  const analyzed = orphanPayments.map((payment) => {
    const customer = payment.customer;
    const hasActiveSubscriptions = customer._count.subscriptions > 0;
    const hasOtherPayments = customer._count.payments > 1;
    const hasWompiTransaction = Boolean(payment.wompiTransactionId);
    const isApproved = payment.status === "APPROVED";

    let recommendedAction: "KEEP" | "DELETE" | "REVIEW" = "REVIEW";
    let reason = "";

    if (hasActiveSubscriptions) {
      recommendedAction = "KEEP";
      reason = "Cliente tiene suscripciones activas";
    } else if (hasOtherPayments) {
      recommendedAction = "KEEP";
      reason = "Cliente tiene otros pagos";
    } else if (isApproved) {
      recommendedAction = "KEEP";
      reason = "Pago aprobado (histórico)";
    } else if (hasWompiTransaction) {
      recommendedAction = "REVIEW";
      reason = "Tiene transacción Wompi - verificar match";
    } else {
      recommendedAction = "DELETE";
      reason = "Huérfano sin transacción - candidato a eliminar";
    }

    return {
      ...payment,
      _analysis: {
        hasActiveSubscriptions,
        hasOtherPayments,
        hasWompiTransaction,
        isApproved,
        recommendedAction,
        reason,
        customerAge: customer.createdAt ? Math.floor((Date.now() - new Date(customer.createdAt).getTime()) / 86400000) : null
      }
    };
  });

  const summary = {
    total: analyzed.length,
    keep: analyzed.filter((p) => p._analysis.recommendedAction === "KEEP").length,
    delete: analyzed.filter((p) => p._analysis.recommendedAction === "DELETE").length,
    review: analyzed.filter((p) => p._analysis.recommendedAction === "REVIEW").length
  };

  return Response.json({
    payments: analyzed,
    summary,
    cutoffDate: cutoffDate.toISOString()
  });
}
