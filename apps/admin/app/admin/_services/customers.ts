import "server-only";

import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { consumeApp } from "@suscripciones/core/services/superAdminApp";
import { syncChatwootAttributesForCustomer } from "@suscripciones/core/services/chatwootSync";
import { GamificationEntityType } from "@prisma/client";
import { formatLevelName } from "@suscripciones/core/services/gamification";
import { applyGamificationEvent, GAMIFICATION_EVENT_KINDS } from "@suscripciones/core/services/gamification";
import { WompiClient } from "@suscripciones/core/providers/wompi/client";
import {
  getWompiApiBaseUrl,
  getWompiCheckoutLinkBaseUrl,
  getWompiPrivateKey,
  getWompiPublicKey
} from "@suscripciones/core/services/runtimeConfig";

export const createCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email(),
  phone: z.string().min(6),
  metadata: z
    .object({
      identificacion: z.string().optional(),
      identificacionNumero: z.string().optional(),
      identificationNumber: z.string().optional(),
      documentNumber: z.string().optional(),
      document: z.string().optional(),
      tokenizationLink: z
        .object({
          token: z.string(),
          expiresAt: z.string().datetime().optional(),
          usedAt: z.string().datetime().optional()
        })
        .optional(),
      wompi: z
        .object({
          paymentSourceId: z.number().optional(),
          paymentSourceType: z.string().optional(),
          paymentSources: z
            .array(
              z.object({
                id: z.number(),
                type: z.string(),
                createdAt: z.string().optional()
              })
            )
            .optional(),
          acceptancePermalink: z.string().optional(),
          personalDataPermalink: z.string().optional(),
          createdAt: z.string().datetime().optional()
        })
        .optional(),
      chatwoot: z
        .object({
          contactId: z.number().optional(),
          sourceId: z.string().optional(),
          attributesSyncedAt: z.string().datetime().optional()
        })
        .optional()
    })
    .passthrough()
    .optional()
});

type ClearPaymentSourceOk = {
  ok: true;
  customer: any;
  paymentSourceId: number | null;
};

type ClearPaymentSourceFail = { ok: false; status: number; error: string };

export async function clearCustomerPaymentSource(args: {
  customerId: string;
  sourceId?: number | null;
}): Promise<ClearPaymentSourceOk | ClearPaymentSourceFail> {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "missing_customer_id" };

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { ok: false, status: 404, error: "customer_not_found" };

  const sourceIdRaw = Number(args.sourceId ?? 0);
  const existing = (customer.metadata ?? {}) as any;
  const existingWompi = existing?.wompi && typeof existing.wompi === "object" ? existing.wompi : {};
  const existingSources = Array.isArray(existingWompi?.paymentSources) ? existingWompi.paymentSources : [];
  const activeId = existingWompi?.paymentSourceId;
  const targetId = Number.isFinite(sourceIdRaw) && sourceIdRaw > 0 ? sourceIdRaw : Number(activeId || 0) || 0;

  const nextSources = targetId ? existingSources.filter((s: any) => Number(s?.id) !== targetId) : existingSources;
  const nextActive = nextSources.length ? nextSources[nextSources.length - 1] : null;

  const merged = {
    ...(existing && typeof existing === "object" ? existing : {}),
    wompi: {
      ...(existingWompi || {}),
      paymentSourceId: nextActive?.id ?? null,
      paymentSourceType: nextActive?.type ?? null,
      paymentSources: nextSources
    }
  };

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { metadata: merged as any }
  });

  return { ok: true, customer: updated, paymentSourceId: nextActive?.id ?? null };
}

export async function getCustomerById(customerId: string) {
  const id = String(customerId || "").trim();
  if (!id) return null;
  return prisma.customer.findUnique({ where: { id } });
}

export async function listCustomers(args: {
  tenantId?: string | null;
  take?: number;
  skip?: number;
  q?: string;
  ids?: string[];
}) {
  const tenantId = args.tenantId || null;
  const takeRaw = Number(args.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const skipRaw = Number(args.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(args.q ?? "").trim();
  const ids = Array.isArray(args.ids) ? args.ids.map((v) => v.trim()).filter(Boolean) : [];

  const where: any = {};
  if (tenantId) {
    where.AND = [{ OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] }];
  }
  if (q) {
    const or: any[] = [];
    const digits = q.replace(/[^\d]/g, "");
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(q);
    const isEmail = q.includes("@");

    if (isUuid) or.push({ id: q });
    if (isEmail) {
      or.push({ email: { contains: q, mode: "insensitive" } });
    }
    or.push({ name: { contains: q, mode: "insensitive" } });
    if (!isEmail) {
      or.push({ email: { contains: q, mode: "insensitive" } });
    }
    if (digits.length >= 4) {
      or.push({ phone: { contains: digits } });
      or.push({ phone: { contains: q } });
    } else {
      or.push({ phone: { contains: q, mode: "insensitive" } });
    }
    or.push({ metadata: { path: ["identificacion"], string_contains: q } } as any);
    or.push({ metadata: { path: ["identificacionNumero"], string_contains: q } } as any);
    or.push({ metadata: { path: ["identificationNumber"], string_contains: q } } as any);
    or.push({ metadata: { path: ["documentNumber"], string_contains: q } } as any);
    or.push({ metadata: { path: ["document"], string_contains: q } } as any);
    if (!where.AND) where.AND = [];
    where.AND.push({ OR: or });
  }

  if (ids.length) {
    if (!where.AND) where.AND = [];
    where.AND.push({ id: { in: ids } });
  }

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: { tenantLinks: { select: { tenantId: true } } }
    }),
    prisma.customer.count({ where })
  ]);

  return {
    items: items.map((c: any) => ({
      ...c,
      tenantIds: Array.from(
        new Set(
          [...(Array.isArray(c?.tenantLinks) ? c.tenantLinks.map((t: any) => String(t?.tenantId || "")) : []), String(c?.tenantId || "")]
            .map((v) => String(v || "").trim())
            .filter(Boolean)
        )
      )
    })),
    total
  };
}

export async function getCustomerWithGamification(args: { customerId: string; tenantId?: string | null }) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "id_invalido" as const };

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { ok: false, status: 404, error: "customer_no_encontrado" as const };

  const tenantId = args.tenantId || null;
  if (tenantId) {
    const allowed =
      customer.tenantId === tenantId || (await prisma.customerTenant.count({ where: { customerId, tenantId } })) > 0;
    if (!allowed) return { ok: false, status: 404, error: "customer_no_encontrado" as const };
  }

  const gamificationRows = await prisma.gamificationScore.findMany({
    where: {
      entityType: GamificationEntityType.CUSTOMER,
      entityId: customerId,
      ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : { tenantId: null })
    }
  });
  const global = gamificationRows.find((row) => row.tenantId == null) || null;
  const byTenant = gamificationRows.filter((row) => row.tenantId != null).map((row) => ({
    ...row,
    levelName: formatLevelName(row.level)
  }));
  const globalWithName = global ? { ...global, levelName: formatLevelName(global.level) } : null;
  const gamificacionResponse = globalWithName || byTenant.length > 0 ? { global: globalWithName, byTenant } : null;

  return { ok: true, customer, gamification: gamificacionResponse };
}

export async function updateCustomerMetadata(args: { customerId: string; metadata: any }) {
  const id = String(args.customerId || "").trim();
  if (!id) return null;
  return prisma.customer.update({
    where: { id },
    data: { metadata: args.metadata as any }
  });
}

type CreateCustomerOk = { ok: true; customer: any };
type CreateCustomerFail = { ok: false; status: number; error: string; message?: string; details?: any; customerId?: string };

export async function createCustomer(args: {
  data: z.infer<typeof createCustomerSchema>;
  tenantIds: string[];
}): Promise<CreateCustomerOk | CreateCustomerFail> {
  const emailNormalizado = args.data.email.toLowerCase().trim();
  
  // Solo verificar si el email está vacío cuando es requerido
  // Permitir emails duplicados - el sistema maneja múltiples contactos con mismo email
  
  const phoneNormalizado = args.data.phone.replace(/[^\d+]/g, "").trim();
  if (phoneNormalizado.length >= 10) {
    const existingPhone = await prisma.customer.findFirst({
      where: { phone: { contains: phoneNormalizado.slice(-10) } }
    });
    if (existingPhone) {
      console.warn("[Customers/Create] Phone potencialmente duplicado", {
        phone: phoneNormalizado,
        existingCustomerId: existingPhone.id,
        existingCustomerName: existingPhone.name
      });
    }
  }

  if (!args.tenantIds.length) {
    return { ok: false, status: 400, error: "tenant_requerido", message: "Debe pertenecer al menos a un tenant" };
  }
  const primaryTenantId = args.tenantIds[0];

  try {
    const customer = await prisma.customer.create({
      data: {
        ...(args.data as any),
        email: emailNormalizado,
        tenantId: primaryTenantId
      }
    });
    await prisma.customerTenant
      .createMany({ data: args.tenantIds.map((t) => ({ customerId: customer.id, tenantId: t })), skipDuplicates: true })
      .catch(() => {});
    await consumeApp("customers_created", { amount: 1, source: "api:customers.create", meta: { customerId: customer.id } });
    await syncChatwootAttributesForCustomer(customer.id).catch((err) => {
      console.error("[Customers/Create] Fallo sincronización Chatwoot", {
        customerId: customer.id,
        error: err?.message || String(err)
      });
    });
    console.log("[Customers/Create] Customer creado exitosamente", {
      customerId: customer.id,
      email: customer.email,
      tenantIds: args.tenantIds
    });
    return { ok: true, customer };
  } catch (err: any) {
    if (err?.code === "P2002") {
      return {
        ok: false,
        status: 409,
        error: "registro_duplicado",
        message: "Ya existe un registro con estos datos",
        details: err?.meta?.target || "desconocida"
      };
    }
    console.error("[Customers/Create] Error creando customer", {
      email: emailNormalizado,
      error: err?.message || String(err),
      stack: err?.stack
    });
    throw err;
  }
}

function extractIdValue(meta: any) {
  if (!meta || typeof meta !== "object") return "";
  const value =
    meta.identificacion ||
    meta.identificacionNumero ||
    meta.identificationNumber ||
    meta.documentNumber ||
    meta.document ||
    meta.documento ||
    "";
  return String(value || "").trim();
}

export async function updateCustomerProfile(args: {
  customerId: string;
  tenantId?: string | null;
  tenantIds?: string[];
  primaryTenantId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: any;
}) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "invalid_id" as const };

  const existing = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!existing) return { ok: false, status: 404, error: "customer_not_found" as const };

  if (args.tenantId) {
    const allowed =
      existing.tenantId === args.tenantId || (await prisma.customerTenant.count({ where: { customerId, tenantId: args.tenantId } })) > 0;
    if (!allowed) return { ok: false, status: 404, error: "customer_not_found" as const };
  }

  const requestedTenantIds: string[] = Array.from(
    new Set((args.tenantIds || []).map((value) => String(value || "").trim()).filter(Boolean))
  );
  const requestedPrimaryTenantId = String(args.primaryTenantId || "").trim();
  if (requestedPrimaryTenantId && requestedTenantIds.length && !requestedTenantIds.includes(requestedPrimaryTenantId)) {
    return { ok: false, status: 400, error: "primary_tenant_not_in_list" as const };
  }

  let nextTenantIds: string[] = requestedTenantIds;
  if (!requestedTenantIds.length) {
    const existingLinks = await prisma.customerTenant.findMany({ where: { customerId }, select: { tenantId: true } });
    nextTenantIds = Array.from(
      new Set(
        [...existingLinks.map((link: any) => String(link.tenantId || "")), String(existing.tenantId || "")]
          .map((v) => String(v || "").trim())
          .filter(Boolean)
      )
    );
  }

  if (nextTenantIds.length) {
    const countTenants = await prisma.saTenant.count({ where: { id: { in: nextTenantIds } } });
    if (countTenants !== nextTenantIds.length) return { ok: false, status: 400, error: "tenant_not_found" as const };
  }

  if (requestedPrimaryTenantId && !nextTenantIds.includes(requestedPrimaryTenantId)) {
    return { ok: false, status: 400, error: "primary_tenant_not_in_list" as const };
  }
  const nextPrimaryTenantId = requestedPrimaryTenantId || nextTenantIds[0] || null;

  const data: any = {};
  if (args.name !== undefined) data.name = args.name === "" ? null : args.name;
  if (args.email !== undefined) data.email = args.email === "" ? null : args.email;
  if (args.phone !== undefined) data.phone = args.phone === "" ? null : args.phone;
  if (args.metadata !== undefined) data.metadata = args.metadata;

  const updated = await prisma.$transaction(async (tx) => {
    const customerUpdated = await tx.customer.update({
      where: { id: customerId },
      data: {
        ...data,
        tenantId: nextPrimaryTenantId
      }
    });

    if (requestedTenantIds.length) {
      await tx.customerTenant.deleteMany({ where: { customerId } });
      if (nextTenantIds.length) {
        await tx.customerTenant.createMany({
          data: nextTenantIds.map((tenantId) => ({ customerId, tenantId })),
          skipDuplicates: true
        });
      }
    }

    return customerUpdated;
  });

  await syncChatwootAttributesForCustomer(updated.id).catch(() => {});

  const prevEmail = String(existing?.email || "").trim();
  const nextEmail = String(updated.email || "").trim();
  const prevPhone = String(existing?.phone || "").trim();
  const nextPhone = String(updated.phone || "").trim();
  const prevId = extractIdValue(existing?.metadata);
  const nextId = extractIdValue(updated?.metadata);

  if (!prevEmail && nextEmail) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: updated.id,
      tenantId: updated.tenantId || null,
      kind: GAMIFICATION_EVENT_KINDS.DATA_EMAIL_ADDED,
      metadata: { source: "customers.update" }
    }).catch(() => {});
  }

  if (!prevPhone && nextPhone) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: updated.id,
      tenantId: updated.tenantId || null,
      kind: GAMIFICATION_EVENT_KINDS.DATA_PHONE_ADDED,
      metadata: { source: "customers.update" }
    }).catch(() => {});
  }

  if (!prevId && nextId) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: updated.id,
      tenantId: updated.tenantId || null,
      kind: GAMIFICATION_EVENT_KINDS.DATA_ID_ADDED,
      metadata: { source: "customers.update" }
    }).catch(() => {});
  }

  return { ok: true, customer: updated };
}

export async function deleteCustomerProfile(args: { customerId: string; tenantId?: string | null; force?: boolean }) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "id_invalido" as const };

  if (args.tenantId) {
    const existing = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!existing) return { ok: false, status: 404, error: "customer_no_encontrado" as const };
    const allowed =
      existing.tenantId === args.tenantId || (await prisma.customerTenant.count({ where: { customerId, tenantId: args.tenantId } })) > 0;
    if (!allowed) return { ok: false, status: 404, error: "customer_no_encontrado" as const };
  }

  const [subscriptionsCount, paymentsCount, chatwootCount, smartListCount, campaignCount, gamificationScoreCount, gamificationEventCount] =
    await Promise.all([
      prisma.subscription.count({ where: { customerId } }),
      prisma.payment.count({ where: { customerId } }),
      prisma.chatwootMessage.count({ where: { customerId } }),
      prisma.smartListMember.count({ where: { customerId } }),
      prisma.campaignSend.count({ where: { customerId } }),
      prisma.gamificationScore.count({ where: { entityType: GamificationEntityType.CUSTOMER, entityId: customerId } }),
      prisma.gamificationEvent.count({ where: { entityType: GamificationEntityType.CUSTOMER, entityId: customerId } })
    ]);

  const force = Boolean(args.force);
  if (
    !force &&
    (subscriptionsCount || paymentsCount || chatwootCount || smartListCount || campaignCount || gamificationScoreCount || gamificationEventCount)
  ) {
    return {
      ok: false,
      status: 409,
      error: "customer_tiene_dependencias",
      details: {
        subscriptionsCount,
        paymentsCount,
        chatwootCount,
        smartListCount,
        campaignCount,
        gamificationScoreCount,
        gamificationEventCount
      }
    };
  }

  if (force) {
    const subscriptions = await prisma.subscription.findMany({
      where: { customerId },
      select: { id: true }
    });
    const subscriptionIds = subscriptions.map((s: any) => s.id);
    const payments = await prisma.payment.findMany({
      where: {
        OR: [{ customerId }, ...(subscriptionIds.length ? [{ subscriptionId: { in: subscriptionIds } }] : [])]
      },
      select: { id: true }
    });
    const paymentIds = payments.map((p: any) => p.id);

    if (gamificationEventCount > 0) {
      await prisma.gamificationEvent
        .deleteMany({
          where: {
            entityType: GamificationEntityType.CUSTOMER,
            entityId: customerId
          }
        })
        .catch(() => {});
    }

    if (gamificationScoreCount > 0) {
      await prisma.gamificationScore
        .deleteMany({
          where: {
            entityType: GamificationEntityType.CUSTOMER,
            entityId: customerId
          }
        })
        .catch(() => {});
    }

    if (paymentIds.length) {
      await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
    }
    await prisma.chatwootMessage
      .deleteMany({
        where: {
          OR: [
            { customerId },
            ...(subscriptionIds.length ? [{ subscriptionId: { in: subscriptionIds } }] : []),
            ...(paymentIds.length ? [{ paymentId: { in: paymentIds } }] : [])
          ]
        }
      })
      .catch(() => {});
    if (paymentIds.length) {
      await prisma.paymentLink.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
    }
    await prisma.payment
      .deleteMany({
        where: {
          OR: [{ customerId }, ...(subscriptionIds.length ? [{ subscriptionId: { in: subscriptionIds } }] : [])]
        }
      })
      .catch(() => {});
    if (subscriptionIds.length) {
      await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } }).catch(() => {});
    }
    await prisma.subscription.deleteMany({ where: { customerId } }).catch(() => {});
    await prisma.smartListMember.deleteMany({ where: { customerId } }).catch(() => {});
    await prisma.campaignSend.deleteMany({ where: { customerId } }).catch(() => {});
    await prisma.customerTenant.deleteMany({ where: { customerId } }).catch(() => {});
  }

  await prisma.customer.delete({ where: { id: customerId } });
  return { ok: true };
}

export async function createWompiPaymentSource(args: { customerId: string; type: "CARD" | "NEQUI" | "PSE"; token: string }) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "invalid_customer_id" as const };
  const token = String(args.token || "").trim();
  if (!token) return { ok: false, status: 400, error: "missing_token" as const };

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { ok: false, status: 404, error: "customer_not_found" as const };
  if (!customer.email) return { ok: false, status: 400, error: "customer_email_required" as const };

  const publicKey = await getWompiPublicKey();
  if (!publicKey) return { ok: false, status: 400, error: "wompi_public_key_not_configured" as const };
  const privateKey = await getWompiPrivateKey();
  if (!privateKey) return { ok: false, status: 400, error: "wompi_private_key_not_configured" as const };

  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey, checkoutLinkBaseUrl });
  const merchant = await wompi.getMerchant(publicKey);

  const created = await wompi.createPaymentSource({
    type: args.type,
    token,
    customer_email: customer.email,
    acceptance_token: merchant.acceptanceToken,
    accept_personal_auth: merchant.acceptPersonalAuth
  });

  const existing = (customer.metadata ?? {}) as any;
  const existingWompi = existing?.wompi && typeof existing.wompi === "object" ? existing.wompi : {};
  const existingSources = Array.isArray(existingWompi?.paymentSources) ? existingWompi.paymentSources : [];
  const nextSources = [
    ...existingSources.filter((s: any) => Number(s?.id) !== created.id),
    { id: created.id, type: args.type, createdAt: new Date().toISOString() }
  ];
  const merged = {
    ...(existing && typeof existing === "object" ? existing : {}),
    wompi: {
      ...(existingWompi || {}),
      paymentSourceId: created.id,
      paymentSourceType: args.type,
      paymentSources: nextSources,
      acceptancePermalink: merchant.acceptancePermalink,
      personalDataPermalink: merchant.personalDataPermalink,
      createdAt: new Date().toISOString()
    }
  };

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { metadata: merged as any }
  });

  return { ok: true, customer: updated, paymentSourceId: created.id };
}

export async function consumeTokenizationLink(args: { token: string }) {
  const token = String(args.token || "").trim();
  if (!token) return { ok: false, status: 400, error: "token_no_proporcionado" as const };

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: token } as any }
  });
  if (!customer) return { ok: false, status: 404, error: "token_no_encontrado" as const };

  const meta: any = customer.metadata ?? {};
  const link = meta?.tokenizationLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  const usedAt = link?.usedAt ? new Date(link.usedAt) : null;

  if (usedAt) return { ok: false, status: 409, error: "token_ya_usado", usedAt: usedAt.toISOString() };

  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 410, error: "token_expirado", expiresAt: expiresAt.toISOString() };
  }

  const now = new Date().toISOString();
  const updated = await prisma.$executeRaw`
    UPDATE "Customer"
    SET "metadata" = jsonb_set(COALESCE("metadata",'{}'::jsonb), '{tokenizationLink,usedAt}', to_jsonb(${now}::text), true)
    WHERE "metadata"->'tokenizationLink'->>'token' = ${token}
      AND (("metadata"->'tokenizationLink'->>'usedAt') IS NULL OR ("metadata"->'tokenizationLink'->>'usedAt') = '')
  `;

  if (!updated) return { ok: false, status: 409, error: "token_ya_usado" };
  return { ok: true, customerId: customer.id, usedAt: now };
}
