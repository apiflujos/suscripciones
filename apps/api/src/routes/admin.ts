import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
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

  const matchesToken = expectedTokens.some((expected) => {
    if (expected.length !== token.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    } catch {
      return false;
    }
  });

  if (!token || !expectedTokens.length || !matchesToken) {
    const reason = !expectedTokens.length ? "expected_not_configured" : !token ? "missing_token" : "token_mismatch";
    const debugAuth = (process.env.DEBUG_AUTH || "").trim() === "1" && process.env.NODE_ENV !== "production";
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
  const withCount = String(req.query.count ?? "") === "1";
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 20)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const q = String(req.query.q ?? "").trim();
  const processStatus = String(req.query.processStatus ?? "").trim();
  const fromRaw = String(req.query.from ?? "").trim();
  const toRaw = String(req.query.to ?? "").trim();
  const tenantId = String(req.query.tenantId ?? "").trim();

  const parseDate = (raw: string) => {
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const defaultFromDate = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw);

  const baseWhere = {
    ...(processStatus ? { processStatus: processStatus as any } : {}),
    ...(tenantId ? { tenantId } : {}),
    receivedAt: {
      gte: fromDate,
      ...(toDate ? { lt: toDate } : {})
    }
  } as any;

  const [items, total] = await Promise.all([
    prisma.webhookEvent.findMany({
      orderBy: { receivedAt: "desc" },
      take,
      skip,
      where: baseWhere
    }),
    withCount && !q ? prisma.webhookEvent.count({ where: baseWhere }) : Promise.resolve(null)
  ]);

  const extractTx = (payload: unknown): Record<string, any> => {
    if (!payload || typeof payload !== "object") return {};
    const root = payload as Record<string, any>;
    const data = root.data;
    if (data && typeof data === "object") {
      const tx = (data as any).transaction;
      if (tx && typeof tx === "object") return tx as Record<string, any>;
      // Some Wompi-like payloads use `data` as the transaction itself.
      if ((data as any).id || (data as any).reference) return data as Record<string, any>;
      const nested = (data as any).data;
      if (nested && typeof nested === "object" && (((nested as any).id && typeof (nested as any).id !== "object") || (nested as any).reference)) {
        return nested as Record<string, any>;
      }
    }
    const direct = (root as any).transaction;
    if (direct && typeof direct === "object") return direct as Record<string, any>;
    return {};
  };

  const paymentLinkIds = new Set<string>();
  const references = new Set<string>();
  const transactionIds = new Set<string>();
  for (const item of items) {
    const tx: any = extractTx(item.payload);
    const linkId = tx?.payment_link_id ?? tx?.paymentLinkId ?? tx?.payment_link?.id ?? tx?.paymentLink?.id;
    if (linkId) paymentLinkIds.add(String(linkId));
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
      select: {
        id: true,
        reference: true,
        wompiPaymentLinkId: true,
        wompiTransactionId: true,
        amountInCents: true,
        currency: true,
        status: true,
        subscriptionId: true,
        subscription: { select: { plan: { select: { name: true, metadata: true } } } },
        customer: { select: { id: true, name: true, email: true, phone: true } }
      }
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
    const tx = extractTx(item.payload);
    const linkId = tx?.payment_link_id ? String(tx.payment_link_id) : tx?.paymentLinkId ? String(tx.paymentLinkId) : "";
    const reference = String(tx?.reference || "");
    const txId = tx?.id ? String(tx.id) : "";
    if (linkId && paymentByLink.has(linkId)) return paymentByLink.get(linkId) || null;
    if (txId && paymentByTx.has(txId)) return paymentByTx.get(txId) || null;
    if (reference && paymentByRef.has(reference)) return paymentByRef.get(reference) || null;
    return null;
  }

  function paymentTypeFor(item: any) {
    const tx = extractTx(item.payload);
    const linkId = tx?.payment_link_id ? String(tx.payment_link_id) : tx?.paymentLinkId ? String(tx.paymentLinkId) : "";
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

  const normalized = items.map((item: any) => {
    const tx = extractTx(item.payload);
    const payloadData = (item.payload && typeof item.payload === "object" ? (item.payload as any).data : null) as any;
    const payment = resolvePayment(item);
    return {
      id: item.id,
      eventName: item.eventName,
      processStatus: item.processStatus,
      errorMessage: item.errorMessage,
      receivedAt: item.receivedAt,
      providerTs: item.providerTs != null ? item.providerTs.toString() : null,
      paymentType: paymentTypeFor(item),
      planName: planNameFor(item),
      customerName: payment?.customer?.name || tx?.customer_data?.full_name || tx?.customer_data?.name || tx?.customer_data?.fullName || null,
      customerEmail:
        payment?.customer?.email ||
        tx?.customer_email ||
        tx?.customerEmail ||
        tx?.customer_data?.email ||
        payloadData?.customer_email ||
        payloadData?.customerEmail ||
        null,
      customerPhone:
        payment?.customer?.phone ||
        tx?.customer_data?.phone_number ||
        tx?.customer_data?.phoneNumber ||
        payloadData?.customer_phone ||
        payloadData?.customerPhone ||
        null,
      amountInCents: payment?.amountInCents != null ? Number(payment.amountInCents) : tx?.amount_in_cents ?? tx?.amountInCents ?? null,
      currency: payment?.currency || tx?.currency || null,
      reference: payment?.reference || tx?.reference || null,
      paymentStatus: payment?.status || tx?.status || null,
      wompiTransactionId: payment?.wompiTransactionId || tx?.id || null,
      wompiPaymentLinkId: payment?.wompiPaymentLinkId || tx?.payment_link_id || tx?.paymentLinkId || null
    };
  });

  const filtered = q
    ? normalized.filter((item: any) => {
        const haystack = [
          item.customerName,
          item.customerEmail,
          item.customerPhone,
          item.reference,
          item.wompiTransactionId,
          item.wompiPaymentLinkId,
          item.eventName,
          item.paymentType,
          item.planName,
          item.paymentStatus,
          item.processStatus
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q.toLowerCase());
      })
    : normalized;
  const totalValue = q ? filtered.length : total;
  res.json({ items: filtered, total: totalValue });
}
