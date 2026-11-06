"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@suscripciones/database";
import { reconcileApprovedPaymentWithSubscription } from "@suscripciones/core/services/billingCycles";
import { assertCsrfToken } from "../lib/csrf";
import { resolveReturnTo } from "../lib/returnTo";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import {
  recollectPayments,
  autoAssociateUnlinkedPayments,
  associatePaymentToSubscription,
  reconcilePayment as reconcilePaymentAction,
  reconcilePendingPayments as reconcilePendingPaymentsAction,
  enqueueShopifyForwardForPayment,
  retryFailedWebhooks as retryFailedWebhooksAction
} from "../admin/_services/logsActions";

async function getSuperAdminSession() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  if (!session || session.role !== "SUPER_ADMIN") return null;
  return session;
}

export async function retryFailedWebhooks(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  if (!(await getSuperAdminSession())) return;
  await retryFailedWebhooksAction();
  revalidatePath("/logs");
  revalidatePath("/payments");
}

export async function reconcilePayment(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const session = await getSuperAdminSession();
  if (!session) return;
  const returnTo = safeReturnToLogs(formData);
  const wompiTransactionId = String(formData.get("wompiTransactionId") || "").trim();
  const reference = String(formData.get("reference") || "").trim();
  const paymentId = String(formData.get("paymentId") || "").trim();
  const wompiPaymentLinkId = String(formData.get("wompiPaymentLinkId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  const amountInCentsRaw = Number(String(formData.get("amountInCents") || "0"));
  const amountInCents = Number.isFinite(amountInCentsRaw) ? Math.trunc(amountInCentsRaw) : 0;
  const currency = String(formData.get("currency") || "").trim().toUpperCase();
  if (!wompiTransactionId && !reference && !wompiPaymentLinkId && !paymentId) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}reconcile=fail&reconcileError=missing_ids`);
  }
  let reconcileError: string | null = null;
  try {
    await reconcilePaymentAction({
      wompiTransactionId: wompiTransactionId || undefined,
      reference: reference || undefined,
      paymentId: paymentId || undefined,
      wompiPaymentLinkId: wompiPaymentLinkId || undefined,
      tenantId: tenantId || undefined,
      amountInCents: amountInCents > 0 ? amountInCents : undefined,
      currency: currency || undefined,
      actorEmail: session.email || undefined
    });
    revalidatePath("/logs");
    revalidatePath("/payments");
  } catch (err: any) {
    reconcileError = String(err?.message || err || "reconcile_failed");
  }
  if (reconcileError) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}reconcile=fail&reconcileError=${encodeURIComponent(reconcileError)}`);
  }
  const refLabel = wompiTransactionId || reference || paymentId || wompiPaymentLinkId;
  redirect(
    `${returnTo}${returnTo.includes("?") ? "&" : "?"}reconcile=ok${refLabel ? `&reconcileRef=${encodeURIComponent(refLabel)}` : ""}`
  );
}

export async function associatePayment(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const session = await getSuperAdminSession();
  if (!session) return;
  const returnTo = safeReturnToLogs(formData);
  const paymentId = String(formData.get("paymentId") || "").trim();
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const cycleId = String(formData.get("cycleId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!paymentId || (!subscriptionId && !cycleId)) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}assoc=fail&assocError=missing_ids`);
  }
  const res = await associatePaymentToSubscription({
    paymentId,
    subscriptionId,
    cycleId,
    tenantId: tenantId || undefined,
    actorEmail: session.email || undefined
  });
  if (!res.ok) {
    const err = res.error || "failed";
    if (err === "out_of_cycle" && (res as any).details) {
      const details = (res as any).details;
      const fmt = (value: any) =>
        value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(new Date(value)) : "—";
      const paidAt = fmt(details.paidAt);
      const start = fmt(details.periodStart);
      const end = fmt(details.periodEnd);
      redirect(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}assoc=fail&assocError=${encodeURIComponent(
          `Fuera de ciclo: pago ${paidAt} · ciclo ${start} → ${end}`
        )}`
      );
    }
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}assoc=fail&assocError=${encodeURIComponent(err)}`);
  }
  revalidatePath("/logs");
  revalidatePath("/payments");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}assoc=ok`);
}

/**
 * Asocia varios pagos sueltos a una suscripción, del más viejo al más nuevo.
 * Cada uno pasa por la misma asociación manual de un solo pago: si no encaja en
 * ningún ciclo por fecha, ese se rechaza y los demás siguen.
 */
export async function associatePaymentsBulk(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const session = await getSuperAdminSession();
  if (!session) return;
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const base = `/billing/${encodeURIComponent(subscriptionId)}/associate-payments`;
  const returnTo = resolveReturnTo(formData.get("returnTo"), `/billing/${encodeURIComponent(subscriptionId)}`);
  const goto = (qs: Record<string, string>) =>
    redirect(`${base}?${new URLSearchParams({ ...qs, returnTo }).toString()}`);
  const ids = Array.from(new Set(formData.getAll("paymentId").map((v) => String(v).trim()).filter(Boolean)));
  if (!subscriptionId || !ids.length) goto({ assocNone: "1" });

  const payments = await prisma.payment.findMany({
    where: { id: { in: ids } },
    select: { id: true, paidAt: true, createdAt: true, amountInCents: true }
  });
  payments.sort((a, b) => (a.paidAt || a.createdAt).getTime() - (b.paidAt || b.createdAt).getTime());

  let ok = 0;
  let lastOk: (typeof payments)[number] | null = null;
  const errors: string[] = [];
  for (const payment of payments) {
    // Un pago que falla no debe tumbar el lote: se anota y siguen los demás.
    const res: { ok: boolean; error?: string } = await associatePaymentToSubscription({
      paymentId: payment.id,
      subscriptionId,
      actorEmail: session.email || undefined
    }).catch((err: any) => ({ ok: false, error: String(err?.code || err?.message || "error").slice(0, 60) }));
    if (res.ok) {
      ok += 1;
      lastOk = payment;
      continue;
    }
    const when = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(payment.paidAt || payment.createdAt);
    const why = res.error === "out_of_cycle" ? "no encaja en ningún ciclo por fecha" : String(res.error || "falló");
    errors.push(`${when}: ${why}`);
  }

  // La asociación manual no recalcula el estado: sin esto la suscripción seguiría
  // en mora aunque ya no le quede ningún ciclo vencido.
  if (lastOk) {
    await reconcileApprovedPaymentWithSubscription({
      subscriptionId,
      paymentId: lastOk.id,
      paymentAt: lastOk.paidAt || lastOk.createdAt,
      asOf: new Date()
    }).catch(() => null);
  }

  revalidatePath("/billing");
  revalidatePath(`/billing/${subscriptionId}`);
  revalidatePath("/payments");
  revalidatePath("/logs");
  goto({
    assocOk: String(ok),
    assocFail: String(errors.length),
    ...(errors.length ? { assocErr: errors.slice(0, 6).join(" · ") } : {})
  });
}

export async function reconcilePendingPayments(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  if (!(await getSuperAdminSession())) return;
  const returnTo = safeReturnToLogs(formData);
  const tenantId = String(formData.get("tenantId") || "").trim();
  const daysRaw = Number(String(formData.get("days") || "7"));
  const minutesRaw = Number(String(formData.get("minutes") || "720"));
  const takeRaw = Number(String(formData.get("take") || "100"));
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.trunc(daysRaw), 1), 30) : 7;
  const minutes = Number.isFinite(minutesRaw) ? Math.min(Math.max(Math.trunc(minutesRaw), 10), 60 * 24 * 30) : 720;
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 100;
  let recollectError: string | null = null;
  try {
    await recollectPayments({ days, take: Math.max(200, take) });
    await reconcilePendingPaymentsAction({ minutes, take, ...(tenantId ? { tenantId } : {}) });
    revalidatePath("/logs");
    revalidatePath("/payments");
  } catch (err: any) {
    recollectError = String(err?.message || err || "recollect_failed");
  }
  if (recollectError) {
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}recollect=fail&recollectError=${encodeURIComponent(recollectError)}`
    );
  }
  redirect(
    `${returnTo}${returnTo.includes("?") ? "&" : "?"}recollect=ok&days=${days}&minutes=${minutes}&take=${take}`
  );
}

export async function autoAssociatePayments(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const session = await getSuperAdminSession();
  if (!session) return;
  const returnTo = safeReturnToLogs(formData);
  const tenantId = String(formData.get("tenantId") || "").trim();
  const from = String(formData.get("from") || "").trim();
  const to = String(formData.get("to") || "").trim();
  const takeRaw = Number(String(formData.get("take") || "300"));
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 50), 2000) : 300;
  let assocAllError: string | null = null;
  let assocAllCount = 0;
  let assocAllSkipped = 0;
  let assocAllFailed = 0;
  try {
    const res = await autoAssociateUnlinkedPayments({
      tenantId: tenantId || undefined,
      from: from || undefined,
      to: to || undefined,
      take,
      actorEmail: session.email || undefined
    });
    assocAllCount = Number(res.associated || 0);
    assocAllSkipped = Number(res.skipped || 0);
    assocAllFailed = Number(res.failed || 0);
    revalidatePath("/logs");
    revalidatePath("/payments");
  } catch (err: any) {
    assocAllError = String(err?.message || err || "assoc_all_failed");
  }
  if (assocAllError) {
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}assocAll=fail&assocAllError=${encodeURIComponent(assocAllError)}`
    );
  }
  redirect(
    `${returnTo}${returnTo.includes("?") ? "&" : "?"}assocAll=ok&assocAllCount=${assocAllCount}&assocAllSkipped=${assocAllSkipped}&assocAllFailed=${assocAllFailed}`
  );
}

function safeReturnToLogs(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  if (raw.startsWith("/logs") || raw.startsWith("/payments")) return raw;
  return "/logs?tab=payments";
}

export async function forwardShopifyPayment(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  if (!(await getSuperAdminSession())) return;
  const paymentId = String(formData.get("paymentId") || "").trim();
  const returnTo = safeReturnToLogs(formData);
  if (!paymentId) return;
  const res = await enqueueShopifyForwardForPayment({ paymentId });
  if (!res.ok) {
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}shopifyError=${encodeURIComponent(String(res.error || "unknown_error"))}`
    );
  }
  redirect(
    `${returnTo}${returnTo.includes("?") ? "&" : "?"}shopifyResent=${encodeURIComponent(res.queued ? "queued" : "exists")}`
  );
}
