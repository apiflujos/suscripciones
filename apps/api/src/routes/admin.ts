import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma";

function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}

export function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const tokenFromAuth = auth.startsWith("Bearer ") ? auth : "";
  const tokenFromHeader = req.header("x-admin-token") || "";
  const token = normalizeToken(tokenFromAuth || tokenFromHeader || "");

  const expectedRaw = process.env.ADMIN_API_TOKEN || "";
  const expectedTokens = String(expectedRaw || "")
    .split(/[,\n]/)
    .map((t) => normalizeToken(t))
    .filter(Boolean);

  if (!token || !expectedTokens.length || !expectedTokens.includes(token)) {
    const reason = !expectedTokens.length ? "expected_not_configured" : !token ? "missing_token" : "token_mismatch";
    const debugAuth = (process.env.DEBUG_AUTH || "").trim() === "1";
    res.status(401).json(
      debugAuth
        ? {
            error: "unauthorized",
            reason,
            hasAuthorization: !!auth,
            hasXAdminToken: !!tokenFromHeader,
            receivedLength: token.length,
            expectedCount: expectedTokens.length,
            expectedLengths: expectedTokens.map((t) => t.length)
          }
        : {
            error: "unauthorized",
            reason,
            hasAuthorization: !!auth,
            hasXAdminToken: !!tokenFromHeader
          }
    );
    return;
  }
  next();
}

export async function listWebhookEvents(req: Request, res: Response) {
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 50)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const items = await prisma.webhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take,
    skip
  });
  const paymentLinkIds = new Set<string>();
  const references = new Set<string>();
  const transactionIds = new Set<string>();
  for (const item of items) {
    const tx: any = (item.payload as any)?.data?.transaction;
    if (tx?.payment_link_id) paymentLinkIds.add(String(tx.payment_link_id));
    if (tx?.reference) references.add(String(tx.reference));
    if (tx?.id) transactionIds.add(String(tx.id));
  }

  const paymentFilters: any[] = [];
  if (paymentLinkIds.size) paymentFilters.push({ wompiPaymentLinkId: { in: Array.from(paymentLinkIds) } });
  if (references.size) paymentFilters.push({ reference: { in: Array.from(references) } });
  if (transactionIds.size) paymentFilters.push({ wompiTransactionId: { in: Array.from(transactionIds) } });

  const payments = paymentFilters.length
    ? await prisma.payment.findMany({
        where: { OR: paymentFilters },
        include: { subscription: { include: { plan: true } }, customer: true }
      })
    : [];

  const paymentByLink = new Map<string, (typeof payments)[number]>();
  const paymentByRef = new Map<string, (typeof payments)[number]>();
  const paymentByTx = new Map<string, (typeof payments)[number]>();
  for (const p of payments) {
    if (p.wompiPaymentLinkId) paymentByLink.set(String(p.wompiPaymentLinkId), p);
    if (p.reference) paymentByRef.set(String(p.reference), p);
    if (p.wompiTransactionId) paymentByTx.set(String(p.wompiTransactionId), p);
  }

  function resolvePayment(item: any) {
    const tx = (item.payload as any)?.data?.transaction || {};
    const linkId = tx?.payment_link_id ? String(tx.payment_link_id) : "";
    const reference = String(tx?.reference || "");
    const txId = tx?.id ? String(tx.id) : "";
    if (linkId && paymentByLink.has(linkId)) return paymentByLink.get(linkId) || null;
    if (txId && paymentByTx.has(txId)) return paymentByTx.get(txId) || null;
    if (reference && paymentByRef.has(reference)) return paymentByRef.get(reference) || null;
    return null;
  }

  function paymentTypeFor(item: any) {
    const tx = (item.payload as any)?.data?.transaction || {};
    const linkId = tx?.payment_link_id ? String(tx.payment_link_id) : "";
    const reference = String(tx?.reference || "");
    const payment = resolvePayment(item);

    if (payment?.subscriptionId) {
      const mode = String((payment.subscription as any)?.plan?.metadata?.collectionMode || "");
      if (mode === "AUTO_LINK") return "Pago del plan";
      if (mode === "AUTO_DEBIT") return "Pago suscripción";
      return "Pago suscripción";
    }

    if (reference.startsWith("ORDER_")) return "Pago por link de pago";
    if (reference.startsWith("SUB_")) return "Pago suscripción";
    if (linkId) return "Pago por link de pago";
    return "Pago por link de pago";
  }

  function planNameFor(item: any) {
    const payment = resolvePayment(item);
    return payment?.subscription?.plan?.name || null;
  }

  const normalized = items.map((item: any) => ({
    ...item,
    providerTs: item.providerTs != null ? item.providerTs.toString() : null,
    paymentType: paymentTypeFor(item),
    planName: planNameFor(item),
    customerName: (() => {
      const payment = resolvePayment(item);
      if (payment?.customer?.name) return payment.customer.name;
      const tx = (item.payload as any)?.data?.transaction || {};
      return tx?.customer_data?.full_name || tx?.customer_data?.name || tx?.customer_data?.fullName || null;
    })(),
    customerEmail: (() => {
      const payment = resolvePayment(item);
      if (payment?.customer?.email) return payment.customer.email;
      const tx = (item.payload as any)?.data?.transaction || {};
      return tx?.customer_email || tx?.customerEmail || tx?.customer_data?.email || null;
    })(),
    customerPhone: (() => {
      const payment = resolvePayment(item);
      if (payment?.customer?.phone) return payment.customer.phone;
      const tx = (item.payload as any)?.data?.transaction || {};
      return tx?.customer_data?.phone_number || tx?.customer_data?.phoneNumber || null;
    })(),
    amountInCents: (() => {
      const payment = resolvePayment(item);
      if (payment?.amountInCents != null) return Number(payment.amountInCents);
      const tx = (item.payload as any)?.data?.transaction || {};
      return tx?.amount_in_cents ?? tx?.amountInCents ?? null;
    })(),
    currency: (() => {
      const payment = resolvePayment(item);
      if (payment?.currency) return payment.currency;
      const tx = (item.payload as any)?.data?.transaction || {};
      return tx?.currency || null;
    })(),
    reference: (() => {
      const payment = resolvePayment(item);
      if (payment?.reference) return payment.reference;
      const tx = (item.payload as any)?.data?.transaction || {};
      return tx?.reference || null;
    })(),
    paymentStatus: (() => {
      const payment = resolvePayment(item);
      if (payment?.status) return payment.status;
      const tx = (item.payload as any)?.data?.transaction || {};
      return tx?.status || null;
    })(),
    wompiTransactionId: (() => {
      const payment = resolvePayment(item);
      if (payment?.wompiTransactionId) return payment.wompiTransactionId;
      const tx = (item.payload as any)?.data?.transaction || {};
      return tx?.id || null;
    })(),
    wompiPaymentLinkId: (() => {
      const payment = resolvePayment(item);
      if (payment?.wompiPaymentLinkId) return payment.wompiPaymentLinkId;
      const tx = (item.payload as any)?.data?.transaction || {};
      return tx?.payment_link_id || tx?.paymentLinkId || null;
    })()
  }));
  res.json({ items: normalized });
}
