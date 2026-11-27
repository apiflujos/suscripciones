import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { WompiClient } from "../providers/wompi/client";
import { isShopifyLikePayload } from "../webhooks/wompi/classifyReference";
import { getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiPublicKey } from "./runtimeConfig";
import { reconcileWompiTransaction } from "./wompiReconcile";

const MAX_DAYS = 31;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export type RecoveryOutcome = "pendiente" | "recuperado" | "ya_recibido" | "error";

export type RecoveryItem = {
  id: string;
  reference: string | null;
  amountInCents: number | null;
  currency: string | null;
  createdAt: string | null;
  /** Si es de Shopify, al recuperarlo se encola también su reenvío. */
  shopify: boolean;
  outcome: RecoveryOutcome;
  detail?: string;
};

export type RecoveryResult = {
  items: RecoveryItem[];
  recovered: number;
  alreadyHad: number;
  failed: number;
  /** Error al hablar con Wompi (llaves, red o rango); si viene, `items` puede estar incompleto. */
  error?: string;
};

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * ¿Ya tenemos este pago? Sí si hay un pago aprobado con ese ID de transacción, si un
 * evento suyo ya se procesó, o si ya se le encoló o hizo el reenvío a Shopify (para
 * no duplicarlo allá). Un evento que quedó registrado pero falló NO cuenta: se recupera.
 */
async function alreadyReceived(transactionId: string): Promise<boolean> {
  const [payment, events] = await Promise.all([
    prisma.payment.findFirst({ where: { wompiTransactionId: transactionId, status: "APPROVED" }, select: { id: true } }),
    prisma.webhookEvent.findMany({
      where: { provider: "WOMPI", payload: { path: ["data", "transaction", "id"], equals: transactionId } as any },
      select: { id: true, processStatus: true },
      take: 10
    })
  ]);
  if (payment) return true;
  if (events.some((e) => e.processStatus === "PROCESSED")) return true;
  for (const event of events) {
    const forward = await prisma.retryJob.findFirst({
      where: {
        type: "FORWARD_WOMPI_TO_SHOPIFY",
        status: { in: ["PENDING", "RUNNING", "SUCCEEDED"] },
        payload: { path: ["webhookEventId"], equals: event.id } as any
      },
      select: { id: true }
    });
    if (forward) return true;
  }
  return false;
}

async function listApprovedBetween(fromDay: string, untilDay: string): Promise<{ items: RecoveryItem[]; error?: string }> {
  const [publicKey, privateKey] = await Promise.all([getWompiPublicKey(), getWompiPrivateKey()]);
  const keys = [publicKey, privateKey].filter((k): k is string => Boolean(k));
  if (!keys.length) return { items: [], error: "No hay llaves de Wompi configuradas." };
  const [apiBaseUrl, checkoutLinkBaseUrl] = await Promise.all([getWompiApiBaseUrl(), getWompiCheckoutLinkBaseUrl()]);
  const wompi = new WompiClient({ apiBaseUrl, privateKey: privateKey || "unused", checkoutLinkBaseUrl });

  let lastError = "";
  for (const authKey of keys) {
    const items: RecoveryItem[] = [];
    try {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const batch = await wompi.listTransactionsByDateRange({ authKey, fromDate: fromDay, untilDate: untilDay, page, pageSize: PAGE_SIZE });
        for (const tx of batch) {
          if (String(tx.status || "").toUpperCase() !== "APPROVED") continue;
          items.push({
            id: tx.id,
            reference: tx.reference ?? null,
            amountInCents: tx.amountInCents ?? null,
            currency: tx.currency ?? null,
            createdAt: tx.createdAt != null ? new Date(tx.createdAt as any).toISOString() : null,
            shopify: isShopifyLikePayload({ data: { transaction: tx.raw } }),
            outcome: "pendiente"
          });
        }
        if (batch.length < PAGE_SIZE) break;
      }
      return { items };
    } catch (err: any) {
      lastError = String(err?.message || err).slice(0, 300);
    }
  }
  return { items: [], error: lastError || "No se pudo consultar a Wompi." };
}

/**
 * Trae de Wompi los pagos APROBADOS que no tenemos y los registra como si el
 * webhook hubiera llegado: se procesan y, si son de Shopify, se encola su reenvío.
 *
 * Es lo que hace falta tras una caída: el webhook que Wompi no pudo entregar no
 * está en nuestra base, así que ni un SQL ni "Recolectar" pueden reenviarlo.
 * Solo aprobados, para no mandar avisos tardíos de pagos rechazados.
 *
 * Con `apply = false` solo muestra qué haría. Con `ids` se recuperan esas
 * transacciones puntuales en vez de un rango.
 */
export async function recoverWompiTransactions(args: {
  fromDay?: string;
  untilDay?: string;
  ids?: string[];
  tenantId?: string | null;
  apply: boolean;
}): Promise<RecoveryResult> {
  const result: RecoveryResult = { items: [], recovered: 0, alreadyHad: 0, failed: 0 };

  let candidates: RecoveryItem[] = [];
  if (args.ids?.length) {
    candidates = Array.from(new Set(args.ids.map((i) => i.trim()).filter(Boolean))).map((id) => ({
      id, reference: null, amountInCents: null, currency: null, createdAt: null, shopify: false, outcome: "pendiente" as const
    }));
  } else {
    const fromDay = String(args.fromDay || "");
    const untilDay = String(args.untilDay || "");
    if (!isDay(fromDay) || !isDay(untilDay)) return { ...result, error: "Las fechas deben ser AAAA-MM-DD." };
    const days = (new Date(`${untilDay}T00:00:00Z`).getTime() - new Date(`${fromDay}T00:00:00Z`).getTime()) / 86_400_000;
    if (!(days >= 0) || days > MAX_DAYS) return { ...result, error: `El rango debe ser de 0 a ${MAX_DAYS} días.` };
    const listed = await listApprovedBetween(fromDay, untilDay);
    if (listed.error) return { ...result, error: listed.error };
    candidates = listed.items;
  }

  for (const item of candidates) {
    if (await alreadyReceived(item.id).catch(() => false)) {
      item.outcome = "ya_recibido";
      result.alreadyHad += 1;
      result.items.push(item);
      continue;
    }
    if (!args.apply) {
      result.items.push(item);
      continue;
    }
    try {
      const out: any = await reconcileWompiTransaction({ wompiTransactionId: item.id, tenantId: args.tenantId || undefined, checksumPrefix: "recover" });
      if (out?.ok) {
        item.outcome = "recuperado";
        item.reference = item.reference ?? (out.reference ?? null);
        result.recovered += 1;
      } else {
        item.outcome = "error";
        item.detail = String(out?.reason || "no_se_pudo");
        result.failed += 1;
      }
    } catch (err: any) {
      logger.warn({ err, transactionId: item.id }, "[WompiRecovery] Fallo recuperando una transacción");
      item.outcome = "error";
      item.detail = String(err?.message || "excepcion").slice(0, 160);
      result.failed += 1;
    }
    result.items.push(item);
  }
  return result;
}
