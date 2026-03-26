import "server-only";

import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { LogLevel, PaymentStatus, CredentialProvider } from "@prisma/client";
import { WompiClient } from "@suscripciones/core/providers/wompi/client";
import {
  getWompiApiBaseUrl,
  getWompiCheckoutLinkBaseUrl,
  getWompiPrivateKey,
  getWompiRedirectUrl
} from "@suscripciones/core/services/runtimeConfig";
import { getCredential } from "@suscripciones/core/services/credentials";
import { schedulePaymentLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrencyCode } from "@suscripciones/core/lib/currencies";
import { reqToCompat } from "../_lib/reqCompat";

const currencyCodeSchema = z
  .preprocess((v) => normalizeCurrencyCode(v), z.string().min(3).max(3))
  .refine((v) => isSupportedCurrency(v), { message: "unsupported_currency" });

const lineItemSchema = z.object({
  sku: z.string().optional().nullable(),
  name: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  unitPriceInCents: z.number().int().nonnegative()
});

export const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  reference: z.string().min(1),
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
  expiresAt: z.string().datetime().optional(),
  discountType: z.enum(["NONE", "FIXED", "PERCENT"]).optional().default("NONE"),
  discountValueInCents: z.number().int().nonnegative().optional().default(0),
  discountPercent: z.number().int().min(0).max(100).optional().default(0),
  taxPercent: z.number().int().min(0).max(100).optional().default(0),
  lineItems: z.array(lineItemSchema).min(1),
  sendChatwoot: z.boolean().optional().default(true),
  source: z.enum(["SHOPIFY", "ALEGRA", "MANUAL"]).optional().default("MANUAL")
});

function computeTotals(input: z.infer<typeof createOrderSchema>) {
  const subtotal = input.lineItems.reduce((acc, li) => acc + li.unitPriceInCents * li.quantity, 0);
  const discountBase = subtotal;
  const discount =
    input.discountType === "FIXED"
      ? Math.min(input.discountValueInCents, discountBase)
      : input.discountType === "PERCENT"
        ? Math.trunc((discountBase * input.discountPercent) / 100)
        : 0;
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = input.taxPercent ? Math.trunc((afterDiscount * input.taxPercent) / 100) : 0;
  const total = afterDiscount + tax;
  return { subtotal, discount, tax, total };
}

export async function createManualOrder(args: { req: Request; body: any }) {
  const parsed = createOrderSchema.safeParse(args.body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "invalid_body", details: parsed.error.flatten() };
  }

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return { ok: false, status: 404, error: "customer_not_found" };

  const compatReq = reqToCompat(args.req, args.body);
  const tenantId = customer.tenantId || (await getEffectiveTenantId(compatReq as any));
  if (!tenantId) return { ok: false, status: 400, error: "tenant_required" };
  await prisma.customerTenant
    .createMany({ data: [{ customerId: customer.id, tenantId }], skipDuplicates: true })
    .catch(() => {});

  const totals = computeTotals(parsed.data);

  const payment = await prisma.payment.create({
    data: {
      tenantId,
      customerId: customer.id,
      subscriptionId: null,
      amountInCents: totals.total,
      currency: parsed.data.currency,
      reference: `ORDER_${parsed.data.reference}`,
      status: PaymentStatus.PENDING,
      origin: "MANUAL_USER",
      associationReason: "UNLINKED",
      associatedBy: "system",
      providerResponse: {
        order: {
          source: parsed.data.source,
          reference: parsed.data.reference,
          lineItems: parsed.data.lineItems,
          totals,
          taxPercent: parsed.data.taxPercent,
          discountType: parsed.data.discountType,
          discountValueInCents: parsed.data.discountValueInCents,
          discountPercent: parsed.data.discountPercent,
          expiresAt: parsed.data.expiresAt || null
        }
      } as any
    }
  });

  const privateKey = await getWompiPrivateKey();
  if (!privateKey) return { ok: false, status: 400, error: "wompi_private_key_not_configured" };

  const wompi = new WompiClient({
    apiBaseUrl: await getWompiApiBaseUrl(),
    privateKey,
    checkoutLinkBaseUrl: await getWompiCheckoutLinkBaseUrl()
  });

  const redirectUrl = await getWompiRedirectUrl();
  const customerName = customer.name || customer.email || "Cliente";
  const itemName = parsed.data.lineItems?.[0]?.name ? String(parsed.data.lineItems[0].name) : "Producto";
  const amountLabel = new Intl.NumberFormat("es-CO", { style: "currency", currency: parsed.data.currency, maximumFractionDigits: 0 })
    .format(Math.trunc(totals.total / 100));

  const rawConfig = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
  let cfg: any = null;
  try {
    cfg = rawConfig ? JSON.parse(rawConfig) : null;
  } catch {}
  const templateTitle = String(cfg?.planTitle || "").trim();
  const templateDesc = String(cfg?.planDescription || "").trim();
  const replaceVars = (input: string) =>
    input
      .replaceAll("{contacto}", customerName)
      .replaceAll("{producto}", itemName)
      .replaceAll("{monto}", amountLabel)
      .replaceAll("{periodicidad}", "")
      .replaceAll("{fecha_expira}", parsed.data.expiresAt ? String(parsed.data.expiresAt) : "");
  const wompiTitle = templateTitle ? replaceVars(templateTitle) : `${itemName} · ${customerName}`;
  const wompiDescription = templateDesc ? replaceVars(templateDesc) : `${itemName} · ${amountLabel}`;
  let created: Awaited<ReturnType<WompiClient["createPaymentLink"]>> | null = null;
  try {
    created = await wompi.createPaymentLink({
      name: wompiTitle,
      description: wompiDescription,
      single_use: true,
      collect_shipping: false,
      currency: parsed.data.currency,
      amount_in_cents: totals.total,
      expires_at: parsed.data.expiresAt,
      redirect_url: redirectUrl,
      sku: payment.id
    });
  } catch (err: any) {
    await prisma.payment
      .update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.ERROR,
          providerResponse: { ...(payment.providerResponse as any), wompiError: String(err?.message || err) } as any
        }
      })
      .catch(() => {});
    await systemLog(LogLevel.ERROR, "orders.create", "Wompi link creation failed", {
      paymentId: payment.id,
      err: String(err?.message || err)
    }).catch(() => {});
    return { ok: false, status: 502, error: "wompi_payment_link_failed" };
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      wompiPaymentLinkId: created.id,
      checkoutUrl: created.checkoutUrl
    }
  });

  const scheduledInfo =
    parsed.data.sendChatwoot === false
      ? { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] }
      : await schedulePaymentLinkNotifications({ paymentId: updated.id, forceNow: true }).catch(() => ({
          scheduled: 0,
          sentNow: 0,
          rulesActive: false,
          errors: [] as string[]
        }));

  return {
    ok: true,
    status: 201,
    payment: updated,
    checkoutUrl: updated.checkoutUrl,
    notificationsScheduled: scheduledInfo?.scheduled ?? 0,
    notificationsSent: scheduledInfo?.sentNow ?? 0,
    notificationsRulesActive: scheduledInfo?.rulesActive ?? false,
    chatwootError: scheduledInfo?.errors?.[0] || null
  };
}

export async function createManualOrderForAdmin(args: {
  customerId: string;
  reference: string;
  currency: string;
  lineItems: Array<{ sku?: string | null; name: string; quantity: number; unitPriceInCents: number }>;
  expiresAt?: string;
  discountType?: "NONE" | "FIXED" | "PERCENT";
  discountValueInCents?: number;
  discountPercent?: number;
  taxPercent?: number;
  sendChatwoot?: boolean;
  source?: "SHOPIFY" | "ALEGRA" | "MANUAL";
  tenantId?: string | null;
}) {
  const parsed = createOrderSchema.safeParse({
    customerId: args.customerId,
    reference: args.reference,
    currency: args.currency,
    expiresAt: args.expiresAt,
    discountType: args.discountType,
    discountValueInCents: args.discountValueInCents,
    discountPercent: args.discountPercent,
    taxPercent: args.taxPercent,
    lineItems: args.lineItems,
    sendChatwoot: args.sendChatwoot,
    source: args.source
  });
  if (!parsed.success) {
    return { ok: false, status: 400, error: "invalid_body", details: parsed.error.flatten() };
  }

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return { ok: false, status: 404, error: "customer_not_found" };

  const tenantId = String(args.tenantId || customer.tenantId || "").trim();
  if (!tenantId) return { ok: false, status: 400, error: "tenant_required" };

  await prisma.customerTenant
    .createMany({ data: [{ customerId: customer.id, tenantId }], skipDuplicates: true })
    .catch(() => {});

  const totals = computeTotals(parsed.data);

  const payment = await prisma.payment.create({
    data: {
      tenantId,
      customerId: customer.id,
      subscriptionId: null,
      amountInCents: totals.total,
      currency: parsed.data.currency,
      reference: `ORDER_${parsed.data.reference}`,
      status: PaymentStatus.PENDING,
      origin: "MANUAL_USER",
      associationReason: "UNLINKED",
      associatedBy: "system",
      providerResponse: {
        order: {
          source: parsed.data.source,
          reference: parsed.data.reference,
          lineItems: parsed.data.lineItems,
          totals,
          taxPercent: parsed.data.taxPercent,
          discountType: parsed.data.discountType,
          discountValueInCents: parsed.data.discountValueInCents,
          discountPercent: parsed.data.discountPercent,
          expiresAt: parsed.data.expiresAt || null
        }
      } as any
    }
  });

  const privateKey = await getWompiPrivateKey();
  if (!privateKey) return { ok: false, status: 400, error: "wompi_private_key_not_configured" };

  const wompi = new WompiClient({
    apiBaseUrl: await getWompiApiBaseUrl(),
    privateKey,
    checkoutLinkBaseUrl: await getWompiCheckoutLinkBaseUrl()
  });

  const redirectUrl = await getWompiRedirectUrl();
  const customerName = customer.name || customer.email || "Cliente";
  const itemName = parsed.data.lineItems?.[0]?.name ? String(parsed.data.lineItems[0].name) : "Producto";
  const amountLabel = new Intl.NumberFormat("es-CO", { style: "currency", currency: parsed.data.currency, maximumFractionDigits: 0 }).format(
    Math.trunc(totals.total / 100)
  );

  const rawConfig = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
  let cfg: any = null;
  try {
    cfg = rawConfig ? JSON.parse(rawConfig) : null;
  } catch {}
  const templateTitle = String(cfg?.planTitle || "").trim();
  const templateDesc = String(cfg?.planDescription || "").trim();
  const replaceVars = (input: string) =>
    input
      .replaceAll("{contacto}", customerName)
      .replaceAll("{producto}", itemName)
      .replaceAll("{monto}", amountLabel)
      .replaceAll("{periodicidad}", "")
      .replaceAll("{fecha_expira}", parsed.data.expiresAt ? String(parsed.data.expiresAt) : "");
  const wompiTitle = templateTitle ? replaceVars(templateTitle) : `${itemName} · ${customerName}`;
  const wompiDescription = templateDesc ? replaceVars(templateDesc) : `${itemName} · ${amountLabel}`;

  let created: Awaited<ReturnType<WompiClient["createPaymentLink"]>> | null = null;
  try {
    created = await wompi.createPaymentLink({
      name: wompiTitle,
      description: wompiDescription,
      single_use: true,
      collect_shipping: false,
      currency: parsed.data.currency,
      amount_in_cents: totals.total,
      expires_at: parsed.data.expiresAt,
      redirect_url: redirectUrl,
      sku: payment.id
    });
  } catch (err: any) {
    await prisma.payment
      .update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.ERROR,
          providerResponse: { ...(payment.providerResponse as any), wompiError: String(err?.message || err) } as any
        }
      })
      .catch(() => {});
    await systemLog(LogLevel.ERROR, "orders.create", "Wompi link creation failed", {
      paymentId: payment.id,
      err: String(err?.message || err)
    }).catch(() => {});
    return { ok: false, status: 502, error: "wompi_payment_link_failed" };
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      wompiPaymentLinkId: created.id,
      checkoutUrl: created.checkoutUrl
    }
  });

  const scheduledInfo =
    parsed.data.sendChatwoot === false
      ? { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] }
      : await schedulePaymentLinkNotifications({ paymentId: updated.id, forceNow: true }).catch(() => ({
          scheduled: 0,
          sentNow: 0,
          rulesActive: false,
          errors: [] as string[]
        }));

  return {
    ok: true,
    status: 201,
    payment: updated,
    checkoutUrl: updated.checkoutUrl,
    notificationsScheduled: scheduledInfo?.scheduled ?? 0,
    notificationsSent: scheduledInfo?.sentNow ?? 0,
    notificationsRulesActive: scheduledInfo?.rulesActive ?? false,
    chatwootError: scheduledInfo?.errors?.[0] || null
  };
}

export async function listManualOrders(args: { tenantId?: string | null; take?: number; q?: string; ids?: string[] }) {
  const tenantId = args.tenantId || null;
  const takeRaw = Number(args.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const q = String(args.q ?? "").trim();
  const ids = Array.isArray(args.ids) ? args.ids.map((v) => v.trim()).filter(Boolean) : [];

  const where: any = { subscriptionId: null, wompiPaymentLinkId: { not: null } };
  if (tenantId) where.tenantId = tenantId;
  if (q) {
    where.OR = [
      { reference: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } }
    ];
  }
  if (ids.length) where.id = { in: ids };

  const items = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      customer: true,
      chatwootMsgs: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  return { items };
}
