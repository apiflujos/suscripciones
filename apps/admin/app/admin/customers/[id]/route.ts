import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { logger } from "@suscripciones/core/lib/logger";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { syncChatwootAttributesForCustomer } from "@suscripciones/core/services/chatwootSync";
import { applyGamificationEvent, GAMIFICATION_EVENT_KINDS, formatLevelName } from "@suscripciones/core/services/gamification";
import { GamificationEntityType } from "@prisma/client";
import { getCustomerWithGamification } from "../../_services/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function logIgnored(err: unknown, message: string, context?: Record<string, unknown>) {
  logger.warn({ err, ...(context || {}) }, message);
}

const customerMetadataSchema = z
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
  .passthrough();

const updateCustomerSchema = z.object({
  tenantId: z.string().uuid().optional().or(z.literal("")),
  tenantIds: z.array(z.string().uuid()).optional(),
  primaryTenantId: z.string().uuid().optional().or(z.literal("")),
  name: z.string().min(1).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(6).optional().or(z.literal("")),
  metadata: customerMetadataSchema.optional()
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const customerId = String(params?.id || "").trim();
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  const result = await getCustomerWithGamification({ customerId, tenantId });
  if (!result.ok) {
    if (result.error === "id_invalido") {
      logger.warn({}, "[Customers/GetById] ID no proporcionado");
      return Response.json({ error: "id_invalido", mensaje: "El ID del customer es requerido" }, { status: 400 });
    }
    if (result.error === "customer_no_encontrado") {
      logger.warn({ customerId }, "[Customers/GetById] Customer no encontrado");
      return Response.json({ error: "customer_no_encontrado", mensaje: `El customer ${customerId} no existe` }, { status: 404 });
    }
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ customer: result.customer, gamification: result.gamification });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const customerId = String(params?.id || "").trim();
  if (!customerId) return Response.json({ error: "invalid_id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = updateCustomerSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const data: any = { ...parsed.data };
  const hasTenantPayload =
    Object.prototype.hasOwnProperty.call(body || {}, "tenantId") ||
    Object.prototype.hasOwnProperty.call(body || {}, "tenantIds") ||
    Object.prototype.hasOwnProperty.call(body || {}, "primaryTenantId");
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
    if (!existing) return Response.json({ error: "customer_not_found" }, { status: 404 });
    const compatReq = reqToCompat(req, body);
    const tenantId = await getEffectiveTenantId(compatReq);
    if (tenantId) {
      const allowed =
        existing.tenantId === tenantId || (await prisma.customerTenant.count({ where: { customerId, tenantId } })) > 0;
      if (!allowed) return Response.json({ error: "customer_not_found" }, { status: 404 });
      if (requestedTenantIds.some((id) => id !== tenantId)) {
        return Response.json({ error: "tenant_forbidden" }, { status: 403 });
      }
      if (requestedPrimaryTenantId && requestedPrimaryTenantId !== tenantId) {
        return Response.json({ error: "tenant_forbidden" }, { status: 403 });
      }
    }

    let nextTenantIds: string[] = requestedTenantIds;
    if (!hasTenantPayload) {
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
      if (countTenants !== nextTenantIds.length) return Response.json({ error: "tenant_not_found" }, { status: 400 });
    }
    if (requestedPrimaryTenantId && !nextTenantIds.includes(requestedPrimaryTenantId)) {
      return Response.json({ error: "primary_tenant_not_in_list" }, { status: 400 });
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
    await syncChatwootAttributesForCustomer(updated.id).catch((err) => {
      logIgnored(err, "customers[id]: fallo sincronizando Chatwoot al actualizar", { customerId: updated.id });
    });

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
      }).catch((err) => {
        logIgnored(err, "customers[id]: fallo aplicando gamificación por email", { customerId: updated.id });
      });
    }

    if (!prevPhone && nextPhone) {
      await applyGamificationEvent({
        entityType: GamificationEntityType.CUSTOMER,
        entityId: updated.id,
        tenantId: updated.tenantId || null,
        kind: GAMIFICATION_EVENT_KINDS.DATA_PHONE_ADDED,
        metadata: { source: "customers.update" }
      }).catch((err) => {
        logIgnored(err, "customers[id]: fallo aplicando gamificación por phone", { customerId: updated.id });
      });
    }

    if (!prevId && nextId) {
      await applyGamificationEvent({
        entityType: GamificationEntityType.CUSTOMER,
        entityId: updated.id,
        tenantId: updated.tenantId || null,
        kind: GAMIFICATION_EVENT_KINDS.DATA_ID_ADDED,
        metadata: { source: "customers.update" }
      }).catch((err) => {
        logIgnored(err, "customers[id]: fallo aplicando gamificación por identificación", { customerId: updated.id });
      });
    }

    return Response.json({ customer: updated });
  } catch (err: any) {
    if (String(err?.code) === "P2025") return Response.json({ error: "customer_not_found" }, { status: 404 });
    throw err;
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const customerId = String(params?.id || "").trim();
  if (!customerId) {
    logger.error({}, "[Customers/Delete] ID de customer no proporcionado");
    return Response.json({ error: "id_invalido", mensaje: "El ID del customer es requerido" }, { status: 400 });
  }

  try {
    const compatReq = reqToCompat(req);
    const tenantId = await getEffectiveTenantId(compatReq);
    if (tenantId) {
      const existing = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!existing) {
        logger.warn({ customerId, tenantId }, "[Customers/Delete] Customer no encontrado");
        return Response.json({ error: "customer_no_encontrado", mensaje: `El customer ${customerId} no existe` }, { status: 404 });
      }
      const allowed =
        existing.tenantId === tenantId || (await prisma.customerTenant.count({ where: { customerId, tenantId } })) > 0;
      if (!allowed) {
        logger.warn({ customerId, tenantId }, "[Customers/Delete] Acceso denegado para tenant");
        return Response.json({ error: "customer_no_encontrado", mensaje: "No tienes acceso a este customer" }, { status: 404 });
      }
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

    const force = String(new URL(req.url).searchParams.get("force") || "").trim() === "1";

    if (
      !force &&
      (subscriptionsCount || paymentsCount || chatwootCount || smartListCount || campaignCount || gamificationScoreCount || gamificationEventCount)
    ) {
      logger.warn({
        customerId,
        subscriptionsCount,
        paymentsCount,
        chatwootCount,
        smartListCount,
        campaignCount,
        gamificationScoreCount,
        gamificationEventCount,
        force
      }, "[Customers/Delete] Customer tiene dependencias");
      return Response.json(
        {
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
        },
        { status: 409 }
      );
    }

    if (force) {
      logger.info({ customerId }, "[Customers/Delete] Iniciando eliminación en cascada");

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
          .catch((err) => {
            logger.error({
              customerId,
              err
            }, "[Customers/Delete] Fallo eliminando gamification events");
          });
      }

      if (gamificationScoreCount > 0) {
        await prisma.gamificationScore
          .deleteMany({
            where: {
              entityType: GamificationEntityType.CUSTOMER,
              entityId: customerId
            }
          })
          .catch((err) => {
            logger.error({
              customerId,
              err
            }, "[Customers/Delete] Fallo eliminando gamification scores");
          });
      }

      if (paymentIds.length) {
        await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch((err) => {
          logIgnored(err, "customers[id]: fallo eliminando paymentAttempt en delete forzado", { customerId, paymentIdsCount: paymentIds.length });
        });
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
        .catch((err) => {
          logIgnored(err, "customers[id]: fallo eliminando chatwootMessage en delete forzado", { customerId, subscriptionIdsCount: subscriptionIds.length, paymentIdsCount: paymentIds.length });
        });
      if (paymentIds.length) {
        await prisma.paymentLink.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch((err) => {
          logIgnored(err, "customers[id]: fallo eliminando paymentLink en delete forzado", { customerId, paymentIdsCount: paymentIds.length });
        });
      }
      await prisma.payment
        .deleteMany({
          where: {
            OR: [{ customerId }, ...(subscriptionIds.length ? [{ subscriptionId: { in: subscriptionIds } }] : [])]
          }
        })
        .catch((err) => {
          logIgnored(err, "customers[id]: fallo eliminando payment en delete forzado", { customerId, subscriptionIdsCount: subscriptionIds.length });
        });
      if (subscriptionIds.length) {
        await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } }).catch((err) => {
          logIgnored(err, "customers[id]: fallo eliminando subscriptionTenant en delete forzado", { customerId, subscriptionIdsCount: subscriptionIds.length });
        });
      }
      await prisma.subscription.deleteMany({ where: { customerId } }).catch((err) => {
        logIgnored(err, "customers[id]: fallo eliminando subscription en delete forzado", { customerId });
      });
      await prisma.smartListMember.deleteMany({ where: { customerId } }).catch((err) => {
        logIgnored(err, "customers[id]: fallo eliminando smartListMember en delete forzado", { customerId });
      });
      await prisma.campaignSend.deleteMany({ where: { customerId } }).catch((err) => {
        logIgnored(err, "customers[id]: fallo eliminando campaignSend en delete forzado", { customerId });
      });
      await prisma.customerTenant.deleteMany({ where: { customerId } }).catch((err) => {
        logIgnored(err, "customers[id]: fallo eliminando customerTenant en delete forzado", { customerId });
      });

      logger.info({
        customerId,
        subscriptionsDeleted: subscriptionIds.length,
        paymentsDeleted: paymentIds.length
      }, "[Customers/Delete] Eliminación en cascada completada");
    }

    await prisma.customer.delete({ where: { id: customerId } });
    logger.info({ customerId, force }, "[Customers/Delete] Customer eliminado exitosamente");
    return Response.json({ ok: true, forced: force, customerId });
  } catch (err: any) {
    if (String(err?.code) === "P2025") {
      logger.warn({ customerId }, "[Customers/Delete] Customer ya no existe");
      return Response.json({ error: "customer_no_encontrado", mensaje: "El customer ya fue eliminado" }, { status: 404 });
    }
    if (String(err?.code) === "P2003") {
      logger.error({
        customerId,
        constraint: err?.meta?.constraint_name || "desconocida"
      }, "[Customers/Delete] Violación de clave foránea");
      return Response.json(
        { error: "customer_tiene_dependencias", mensaje: "El customer tiene registros relacionados que impiden su eliminación" },
        { status: 409 }
      );
    }
    logger.error({
      customerId,
      err
    }, "[Customers/Delete] Error eliminando customer");
    return Response.json({ error: "fallo_eliminacion", mensaje: "No se pudo eliminar el customer" }, { status: 500 });
  }
}
