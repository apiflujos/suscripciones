import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiPublicKey } from "../services/runtimeConfig";
import { syncChatwootAttributesForCustomer } from "../services/chatwootSync";
import { consumeApp } from "../services/superAdminApp";
import { getEffectiveTenantId, getEffectiveTenantIds } from "../services/tenantContext";
import { applyGamificationEvent, GAMIFICATION_EVENT_KINDS, formatLevelName } from "../services/gamification";
import { GamificationEntityType } from "@prisma/client";

// FIX: Schema de validación para metadata de customer (debe ir PRIMERO porque se usa en otros schemas)
const customerMetadataSchema = z.object({
  identificacion: z.string().optional(),
  identificacionNumero: z.string().optional(),
  identificationNumber: z.string().optional(),
  documentNumber: z.string().optional(),
  document: z.string().optional(),
  tokenizationLink: z.object({
    token: z.string(),
    expiresAt: z.string().datetime().optional(),
    usedAt: z.string().datetime().optional()
  }).optional(),
  wompi: z.object({
    paymentSourceId: z.number().optional(),
    paymentSourceType: z.string().optional(),
    paymentSources: z.array(z.object({
      id: z.number(),
      type: z.string(),
      createdAt: z.string().optional()
    })).optional(),
    acceptancePermalink: z.string().optional(),
    personalDataPermalink: z.string().optional(),
    createdAt: z.string().datetime().optional()
  }).optional(),
  chatwoot: z.object({
    contactId: z.number().optional(),
    sourceId: z.string().optional(),
    attributesSyncedAt: z.string().datetime().optional()
  }).optional()
}).passthrough(); // Permite campos adicionales pero valida los conocidos

const createCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email(),
  phone: z.string().min(6),
  metadata: customerMetadataSchema.optional()
});

const updateCustomerSchema = z.object({
  tenantId: z.string().uuid().optional().or(z.literal("")),
  tenantIds: z.array(z.string().uuid()).optional(),
  primaryTenantId: z.string().uuid().optional().or(z.literal("")),
  name: z.string().min(1).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(6).optional().or(z.literal("")),
  metadata: customerMetadataSchema.optional()
});

const wompiPaymentSourceSchema = z.object({
  type: z.enum(["CARD", "NEQUI", "PSE"]).default("CARD"),
  token: z.string().min(1)
});

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

export const customersRouter = express.Router();

customersRouter.post("/tokenization-links/:token/consume", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) {
    console.warn('[Tokenization/Consume] Token no proporcionado');
    return res.status(400).json({ error: "token_no_proporcionado", mensaje: "El token es requerido" });
  }

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: token } as any }
  });
  if (!customer) {
    console.warn('[Tokenization/Consume] Token no encontrado', { token });
    return res.status(404).json({ error: "token_no_encontrado", mensaje: "El token no está asociado a ningún customer" });
  }

  const meta: any = customer.metadata ?? {};
  const link = meta?.tokenizationLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  const usedAt = link?.usedAt ? new Date(link.usedAt) : null;

  if (usedAt) {
    console.warn('[Tokenization/Consume] Token ya fue usado', {
      customerId: customer.id,
      token,
      usedAt: usedAt.toISOString()
    });
    return res.status(409).json({ error: "token_ya_usado", mensaje: "Este token ya fue consumido anteriormente", usedAt: usedAt.toISOString() });
  }
  
  // FIX: Logging adecuado para token expirado
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    console.warn('[Tokenization/Consume] Token expirado', {
      customerId: customer.id,
      token,
      expiresAt: expiresAt.toISOString(),
      now: new Date().toISOString(),
      expiredSince: Math.round((Date.now() - expiresAt.getTime()) / (1000 * 60 * 60)) + ' horas'
    });
    return res.status(410).json({ 
      error: "token_expirado", 
      mensaje: "El token ha expirado y ya no puede ser usado",
      expiresAt: expiresAt.toISOString()
    });
  }

  const now = new Date().toISOString();
  const updated = await prisma.$executeRaw`
    UPDATE "Customer"
    SET "metadata" = jsonb_set(COALESCE("metadata",'{}'::jsonb), '{tokenizationLink,usedAt}', to_jsonb(${now}::text), true)
    WHERE "metadata"->'tokenizationLink'->>'token' = ${token}
      AND (("metadata"->'tokenizationLink'->>'usedAt') IS NULL OR ("metadata"->'tokenizationLink'->>'usedAt') = '')
  `;

  if (!updated) {
    console.error('[Tokenization/Consume] Fallo actualizando token', {
      customerId: customer.id,
      token
    });
    return res.status(409).json({ error: "token_ya_usado", mensaje: "No se pudo actualizar el token" });
  }
  
  console.log('[Tokenization/Consume] Token consumido exitosamente', {
    customerId: customer.id,
    token,
    usedAt: now
  });
  res.json({ ok: true, customerId: customer.id, usedAt: now });
});

customersRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const tenantId = await getEffectiveTenantId(req);
  const takeRaw = Number(req?.query?.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const skipRaw = Number(req?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(req?.query?.q ?? "").trim();
  const idsParam = req?.query?.ids;
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (typeof idsParam !== "undefined" && (idsEmpty || ids.length === 0)) {
    return res.json({ items: [], total: 0 });
  }

  const where: any = {};
  if (tenantId) {
    where.AND = [
      { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] }
    ];
  }
  if (q) {
    const or: any[] = [];
    const qLower = q.toLowerCase();
    const digits = q.replace(/[^\d]/g, "");
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(q);
    const isEmail = q.includes("@");
    
    // FIX: Búsqueda case-insensitive consistente (sin redundancia)
    if (isUuid) or.push({ id: q });
    if (isEmail) {
      // Usar solo 'contains' con mode insensitive para emails
      // 'equals' con mode insensitive es redundante y puede causar problemas en algunas DB
      or.push({ email: { contains: q, mode: "insensitive" } });
    }
    or.push({ name: { contains: q, mode: "insensitive" } });
    // También buscar por email con contains para casos parciales
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
  res.json({
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
  });
});

customersRouter.get("/:id", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) {
    console.warn('[Customers/GetById] ID no proporcionado');
    return res.status(400).json({ error: "id_invalido", mensaje: "El ID del customer es requerido" });
  }
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    console.warn('[Customers/GetById] Customer no encontrado', { customerId });
    return res.status(404).json({ error: "customer_no_encontrado", mensaje: `El customer ${customerId} no existe` });
  }
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = customer.tenantId === tenantId
      || (await prisma.customerTenant.count({ where: { customerId, tenantId } })) > 0;
    if (!allowed) {
      console.warn('[Customers/GetById] Acceso denegado', { customerId, tenantId });
      return res.status(404).json({ error: "customer_no_encontrado", mensaje: "No tienes acceso a este customer" });
    }
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
  
  // FIX: Respuesta de gamificación limpia - null si no hay datos
  const gamificacionResponse = (globalWithName || byTenant.length > 0)
    ? { global: globalWithName, byTenant }
    : null;
  
  res.json({ customer, gamification: gamificacionResponse });
});

customersRouter.get("/:id/payments", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "invalid_id" });
  const tenantId = await getEffectiveTenantId(req);
  const takeRaw = Number(req.query.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number(req.query.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;

  const items = await prisma.payment.findMany({
    where: { customerId, ...(tenantId ? { tenantId } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: {
      subscription: { include: { plan: true } },
      attempts: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  res.json({
    items: items.map((p: any) => ({
      id: p.id,
      amountInCents: p.amountInCents,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      reference: p.reference,
      planId: p.subscription?.planId || null,
      planName: p.subscription?.plan?.name || null,
      lastAttempt: p.attempts?.[0]
        ? {
            status: p.attempts[0].status,
            errorMessage: p.attempts[0].errorMessage,
            provider: p.attempts[0].provider,
            createdAt: p.attempts[0].createdAt
          }
        : null
    }))
  });
});

customersRouter.post("/", async (req, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error('[Customers/Create] Validación fallida', {
      error: parsed.error.flatten(),
      body: req.body
    });
    return res.status(400).json({ error: "cuerpo_invalido", detalles: parsed.error.flatten() });
  }

  // FIX: Validar email duplicado (case-insensitive)
  const emailNormalizado = parsed.data.email.toLowerCase().trim();
  const existingEmail = await prisma.customer.findUnique({
    where: { email: emailNormalizado }
  });
  if (existingEmail) {
    console.warn('[Customers/Create] Email duplicado', {
      email: emailNormalizado,
      existingCustomerId: existingEmail.id,
      newCustomerName: parsed.data.name
    });
    return res.status(409).json({ 
      error: "email_ya_existe",
      mensaje: `El email ${emailNormalizado} ya está registrado en el sistema`,
      customerId: existingEmail.id
    });
  }

  // FIX: Validar phone duplicado (opcional, pero recomendado)
  const phoneNormalizado = parsed.data.phone.replace(/[^\d+]/g, '').trim();
  if (phoneNormalizado.length >= 10) {
    const existingPhone = await prisma.customer.findFirst({
      where: { phone: { contains: phoneNormalizado.slice(-10) } }
    });
    if (existingPhone) {
      console.warn('[Customers/Create] Phone potencialmente duplicado', {
        phone: phoneNormalizado,
        existingCustomerId: existingPhone.id,
        existingCustomerName: existingPhone.name
      });
    }
  }

  const tenantIds = await getEffectiveTenantIds(req);
  if (!tenantIds.length) {
    console.error('[Customers/Create] Tenant requerido pero no proporcionado', {
      customerId: parsed.data.email
    });
    return res.status(400).json({ error: "tenant_requerido", mensaje: "Debe pertenecer al menos a un tenant" });
  }
  const primaryTenantId = tenantIds[0];
  
  try {
    const customer = await prisma.customer.create({ 
      data: { 
        ...(parsed.data as any), 
        email: emailNormalizado,
        tenantId: primaryTenantId 
      } 
    });
    await prisma.customerTenant
      .createMany({ data: tenantIds.map((t) => ({ customerId: customer.id, tenantId: t })), skipDuplicates: true })
      .catch(() => {});
    await consumeApp("customers_created", { amount: 1, source: "api:customers.create", meta: { customerId: customer.id } });
    await syncChatwootAttributesForCustomer(customer.id).catch((err) => {
      console.error('[Customers/Create] Fallo sincronización Chatwoot', {
        customerId: customer.id,
        error: err?.message || String(err)
      });
    });
    console.log('[Customers/Create] Customer creado exitosamente', {
      customerId: customer.id,
      email: customer.email,
      tenantIds
    });
    res.status(201).json({ customer });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      console.error('[Customers/Create] Violación de unicidad en BD', {
        email: emailNormalizado,
        constraint: err?.meta?.target || 'desconocida'
      });
      return res.status(409).json({ 
        error: "registro_duplicado",
        mensaje: "Ya existe un registro con estos datos",
        constraint: err?.meta?.target || 'desconocida'
      });
    }
    console.error('[Customers/Create] Error creando customer', {
      email: emailNormalizado,
      error: err?.message || String(err),
      stack: err?.stack
    });
    throw err;
  }
});

customersRouter.put("/:id", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "invalid_id" });
  const parsed = updateCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const data: any = { ...parsed.data };
  const hasTenantPayload =
    Object.prototype.hasOwnProperty.call(req.body || {}, "tenantId")
    || Object.prototype.hasOwnProperty.call(req.body || {}, "tenantIds")
    || Object.prototype.hasOwnProperty.call(req.body || {}, "primaryTenantId");
  const legacyTenantId = String(data.tenantId || "").trim();
  const requestedTenantIdsRaw: string[] = Array.isArray(data.tenantIds)
    ? data.tenantIds.map((value: any) => String(value || "").trim()).filter(Boolean)
    : legacyTenantId
      ? [legacyTenantId]
      : [];
  const requestedTenantIds: string[] = Array.from(new Set(requestedTenantIdsRaw));
  const requestedPrimaryTenantId = String(data.primaryTenantId || "").trim();
  delete data.tenantId;
  delete data.tenantIds;
  delete data.primaryTenantId;
  if (data.name === "") data.name = null;
  if (data.email === "") data.email = null;
  if (data.phone === "") data.phone = null;
  if (data.name === undefined) delete data.name;
  if (data.email === undefined) delete data.email;
  if (data.phone === undefined) delete data.phone;

  try {
    const existing = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!existing) return res.status(404).json({ error: "customer_not_found" });
    const tenantId = await getEffectiveTenantId(req);
    if (tenantId) {
      const allowed = existing.tenantId === tenantId
        || (await prisma.customerTenant.count({ where: { customerId, tenantId } })) > 0;
      if (!allowed) return res.status(404).json({ error: "customer_not_found" });
      if (requestedTenantIds.some((id) => id !== tenantId)) {
        return res.status(403).json({ error: "tenant_forbidden" });
      }
      if (requestedPrimaryTenantId && requestedPrimaryTenantId !== tenantId) {
        return res.status(403).json({ error: "tenant_forbidden" });
      }
    }

    let nextTenantIds: string[] = requestedTenantIds;
    if (!hasTenantPayload) {
      const existingLinks = await prisma.customerTenant.findMany({ where: { customerId }, select: { tenantId: true } });
      nextTenantIds = Array.from(new Set(
        [...existingLinks.map((link: any) => String(link.tenantId || "")), String(existing.tenantId || "")]
          .map((v) => String(v || "").trim())
          .filter(Boolean)
      ));
    }

    if (nextTenantIds.length) {
      const countTenants = await prisma.saTenant.count({ where: { id: { in: nextTenantIds } } });
      if (countTenants !== nextTenantIds.length) return res.status(400).json({ error: "tenant_not_found" });
    }
    if (requestedPrimaryTenantId && !nextTenantIds.includes(requestedPrimaryTenantId)) {
      return res.status(400).json({ error: "primary_tenant_not_in_list" });
    }
    const nextPrimaryTenantId = requestedPrimaryTenantId || nextTenantIds[0] || null;

    const updated = await prisma.$transaction(async (tx) => {
      const customerUpdated = await tx.customer.update({
        where: { id: customerId },
        data: {
          ...data,
          tenantId: nextPrimaryTenantId
        }
      });

      if (hasTenantPayload) {
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

    res.json({ customer: updated });
  } catch (err: any) {
    if (String(err?.code) === "P2025") return res.status(404).json({ error: "customer_not_found" });
    throw err;
  }
});

customersRouter.delete("/:id", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) {
    console.error('[Customers/Delete] ID de customer no proporcionado');
    return res.status(400).json({ error: "id_invalido", mensaje: "El ID del customer es requerido" });
  }
  
  try {
    const tenantId = await getEffectiveTenantId(req);
    if (tenantId) {
      const existing = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!existing) {
        console.warn('[Customers/Delete] Customer no encontrado', { customerId, tenantId });
        return res.status(404).json({ error: "customer_no_encontrado", mensaje: `El customer ${customerId} no existe` });
      }
      const allowed = existing.tenantId === tenantId
        || (await prisma.customerTenant.count({ where: { customerId, tenantId } })) > 0;
      if (!allowed) {
        console.warn('[Customers/Delete] Acceso denegado para tenant', { customerId, tenantId });
        return res.status(404).json({ error: "customer_no_encontrado", mensaje: "No tienes acceso a este customer" });
      }
    }
    
    // Contar dependencias
    const [subscriptionsCount, paymentsCount, chatwootCount, smartListCount, campaignCount, gamificationScoreCount, gamificationEventCount] = await Promise.all([
      prisma.subscription.count({ where: { customerId } }),
      prisma.payment.count({ where: { customerId } }),
      prisma.chatwootMessage.count({ where: { customerId } }),
      prisma.smartListMember.count({ where: { customerId } }),
      prisma.campaignSend.count({ where: { customerId } }),
      prisma.gamificationScore.count({ where: { entityType: GamificationEntityType.CUSTOMER, entityId: customerId } }),
      prisma.gamificationEvent.count({ where: { entityType: GamificationEntityType.CUSTOMER, entityId: customerId } })
    ]);
    
    const force = String((req as any)?.query?.force || "").trim() === "1";

    if (!force && (subscriptionsCount || paymentsCount || chatwootCount || smartListCount || campaignCount || gamificationScoreCount || gamificationEventCount)) {
      console.warn('[Customers/Delete] Customer tiene dependencias', {
        customerId,
        subscriptionsCount,
        paymentsCount,
        chatwootCount,
        smartListCount,
        campaignCount,
        gamificationScoreCount,
        gamificationEventCount,
        force
      });
      return res.status(409).json({
        error: "customer_tiene_dependencias",
        mensaje: "No se puede eliminar el customer porque tiene registros relacionados",
        detalles: { 
          subscriptionsCount, 
          paymentsCount, 
          chatwootCount, 
          smartListCount, 
          campaignCount,
          gamificationScoreCount,
          gamificationEventCount
        }
      });
    }

    if (force) {
      console.log('[Customers/Delete] Iniciando eliminación en cascada', { customerId });
      
      const subscriptions = await prisma.subscription.findMany({
        where: { customerId },
        select: { id: true }
      });
      const subscriptionIds = subscriptions.map((s: any) => s.id);
      const payments = await prisma.payment.findMany({
        where: {
          OR: [
            { customerId },
            ...(subscriptionIds.length ? [{ subscriptionId: { in: subscriptionIds } }] : [])
          ]
        },
        select: { id: true }
      });
      const paymentIds = payments.map((p: any) => p.id);

      // FIX: Eliminar gamificación PRIMERO (antes de que se eliminen los customers)
      if (gamificationEventCount > 0) {
        await prisma.gamificationEvent.deleteMany({ 
          where: { 
            entityType: GamificationEntityType.CUSTOMER,
            entityId: customerId 
          } 
        }).catch((err) => {
          console.error('[Customers/Delete] Fallo eliminando gamification events', { 
            customerId, 
            error: err?.message 
          });
        });
      }
      
      if (gamificationScoreCount > 0) {
        await prisma.gamificationScore.deleteMany({ 
          where: { 
            entityType: GamificationEntityType.CUSTOMER,
            entityId: customerId 
          } 
        }).catch((err) => {
          console.error('[Customers/Delete] Fallo eliminando gamification scores', { 
            customerId, 
            error: err?.message 
          });
        });
      }

      if (paymentIds.length) {
        await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
      }
      await prisma.chatwootMessage.deleteMany({
        where: {
          OR: [
            { customerId },
            ...(subscriptionIds.length ? [{ subscriptionId: { in: subscriptionIds } }] : []),
            ...(paymentIds.length ? [{ paymentId: { in: paymentIds } }] : [])
          ]
        }
      }).catch(() => {});
      if (paymentIds.length) {
        await prisma.paymentLink.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
      }
      await prisma.payment.deleteMany({
        where: {
          OR: [
            { customerId },
            ...(subscriptionIds.length ? [{ subscriptionId: { in: subscriptionIds } }] : [])
          ]
        }
      }).catch(() => {});
      if (subscriptionIds.length) {
        await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } }).catch(() => {});
      }
      await prisma.subscription.deleteMany({ where: { customerId } }).catch(() => {});
      await prisma.smartListMember.deleteMany({ where: { customerId } }).catch(() => {});
      await prisma.campaignSend.deleteMany({ where: { customerId } }).catch(() => {});
      await prisma.customerTenant.deleteMany({ where: { customerId } }).catch(() => {});
      
      console.log('[Customers/Delete] Eliminación en cascada completada', { 
        customerId,
        subscriptionsDeleted: subscriptionIds.length,
        paymentsDeleted: paymentIds.length
      });
    }

    await prisma.customer.delete({ where: { id: customerId } });
    console.log('[Customers/Delete] Customer eliminado exitosamente', { customerId, force });
    res.json({ ok: true, forced: force, customerId });
  } catch (err: any) {
    if (String(err?.code) === "P2025") {
      console.warn('[Customers/Delete] Customer ya no existe', { customerId });
      return res.status(404).json({ error: "customer_no_encontrado", mensaje: "El customer ya fue eliminado" });
    }
    if (String(err?.code) === "P2003") {
      console.error('[Customers/Delete] Violación de clave foránea', { 
        customerId, 
        constraint: err?.meta?.constraint_name || 'desconocida' 
      });
      return res.status(409).json({ error: "customer_tiene_dependencias", mensaje: "El customer tiene registros relacionados que impiden su eliminación" });
    }
    console.error('[Customers/Delete] Error eliminando customer', {
      customerId,
      error: err?.message || String(err),
      stack: err?.stack
    });
    res.status(500).json({ error: "fallo_eliminacion", mensaje: "No se pudo eliminar el customer" });
  }
});

customersRouter.post("/:id/wompi/payment-source", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  const parsed = wompiPaymentSourceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });
  if (!customer.email) return res.status(400).json({ error: "customer_email_required" });

  const publicKey = await getWompiPublicKey();
  if (!publicKey) return res.status(400).json({ error: "wompi_public_key_not_configured" });
  const privateKey = await getWompiPrivateKey();
  if (!privateKey) return res.status(400).json({ error: "wompi_private_key_not_configured" });

  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey, checkoutLinkBaseUrl });
  const merchant = await wompi.getMerchant(publicKey);

  const created = await wompi.createPaymentSource({
    type: parsed.data.type,
    token: parsed.data.token,
    customer_email: customer.email,
    acceptance_token: merchant.acceptanceToken,
    accept_personal_auth: merchant.acceptPersonalAuth
  });

  const existing = (customer.metadata ?? {}) as any;
  const existingWompi = existing?.wompi && typeof existing.wompi === "object" ? existing.wompi : {};
  const existingSources = Array.isArray(existingWompi?.paymentSources) ? existingWompi.paymentSources : [];
  const nextSources = [
    ...existingSources.filter((s: any) => Number(s?.id) !== created.id),
    { id: created.id, type: parsed.data.type, createdAt: new Date().toISOString() }
  ];
  const merged = {
    ...(existing && typeof existing === "object" ? existing : {}),
    wompi: {
      ...(existingWompi || {}),
      paymentSourceId: created.id,
      paymentSourceType: parsed.data.type,
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

  res.status(201).json({ customer: updated, paymentSourceId: created.id });
});

customersRouter.post("/:id/wompi/payment-source/clear", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "missing_customer_id" });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });

  const sourceIdRaw = Number(req.body?.sourceId ?? 0);
  const existing = (customer.metadata ?? {}) as any;
  const existingWompi = existing?.wompi && typeof existing.wompi === "object" ? existing.wompi : {};
  const existingSources = Array.isArray(existingWompi?.paymentSources) ? existingWompi.paymentSources : [];
  const activeId = existingWompi?.paymentSourceId;
  const targetId =
    Number.isFinite(sourceIdRaw) && sourceIdRaw > 0 ? sourceIdRaw : Number(activeId || 0) || 0;

  const nextSources = targetId
    ? existingSources.filter((s: any) => Number(s?.id) !== targetId)
    : existingSources;
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

  res.status(200).json({ ok: true, customer: updated, paymentSourceId: nextActive?.id ?? null });
});
