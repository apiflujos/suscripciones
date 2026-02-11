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

export async function listWebhookEvents(_req: Request, res: Response) {
  const items = await prisma.webhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: 50
  });
  const paymentLinkIds = new Set<string>();
  const references = new Set<string>();
  for (const item of items) {
    const tx: any = (item.payload as any)?.data?.transaction;
    if (tx?.payment_link_id) paymentLinkIds.add(String(tx.payment_link_id));
    if (tx?.reference) references.add(String(tx.reference));
  }

  const payments = paymentLinkIds.size
    ? await prisma.payment.findMany({
        where: { wompiPaymentLinkId: { in: Array.from(paymentLinkIds) } },
        include: { subscription: { include: { plan: true } } }
      })
    : [];

  const paymentByLink = new Map<string, (typeof payments)[number]>();
  for (const p of payments) if (p.wompiPaymentLinkId) paymentByLink.set(String(p.wompiPaymentLinkId), p);

  function paymentTypeFor(item: any) {
    const tx = (item.payload as any)?.data?.transaction || {};
    const linkId = tx?.payment_link_id ? String(tx.payment_link_id) : "";
    const reference = String(tx?.reference || "");
    const payment = linkId ? paymentByLink.get(linkId) : null;

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
    const tx = (item.payload as any)?.data?.transaction || {};
    const linkId = tx?.payment_link_id ? String(tx.payment_link_id) : "";
    const payment = linkId ? paymentByLink.get(linkId) : null;
    return payment?.subscription?.plan?.name || null;
  }

  const normalized = items.map((item) => ({
    ...item,
    providerTs: item.providerTs != null ? item.providerTs.toString() : null,
    paymentType: paymentTypeFor(item),
    planName: planNameFor(item)
  }));
  res.json({ items: normalized });
}
