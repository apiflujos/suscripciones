import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { tokenMeta } from "@suscripciones/core/lib/tokenMeta";
import { logger } from "@suscripciones/core/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const token = String(params?.token || "").trim();
  if (!token) {
    logger.warn({}, "[Tokenization/Consume] Token no proporcionado");
    return Response.json({ error: "token_no_proporcionado", mensaje: "El token es requerido" }, { status: 400 });
  }

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: token } as any }
  });
  if (!customer) {
    logger.warn({ ...tokenMeta(token) }, "[Tokenization/Consume] Token no encontrado");
    return Response.json({ error: "token_no_encontrado", mensaje: "El token no está asociado a ningún customer" }, { status: 404 });
  }

  const meta: any = customer.metadata ?? {};
  const link = meta?.tokenizationLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  const usedAt = link?.usedAt ? new Date(link.usedAt) : null;

  if (usedAt) {
    logger.warn({
      customerId: customer.id,
      ...tokenMeta(token),
      usedAt: usedAt.toISOString()
    }, "[Tokenization/Consume] Token ya fue usado");
    return Response.json(
      { error: "token_ya_usado", mensaje: "Este token ya fue consumido anteriormente", usedAt: usedAt.toISOString() },
      { status: 409 }
    );
  }

  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    logger.warn({
      customerId: customer.id,
      ...tokenMeta(token),
      expiresAt: expiresAt.toISOString(),
      now: new Date().toISOString(),
      expiredSince: Math.round((Date.now() - expiresAt.getTime()) / (1000 * 60 * 60)) + " horas"
    }, "[Tokenization/Consume] Token expirado");
    return Response.json(
      {
        error: "token_expirado",
        mensaje: "El token ha expirado y ya no puede ser usado",
        expiresAt: expiresAt.toISOString()
      },
      { status: 410 }
    );
  }

  const now = new Date().toISOString();
  const updated = await prisma.$executeRaw`
    UPDATE "Customer"
    SET "metadata" = jsonb_set(COALESCE("metadata",'{}'::jsonb), '{tokenizationLink,usedAt}', to_jsonb(${now}::text), true)
    WHERE "metadata"->'tokenizationLink'->>'token' = ${token}
      AND (("metadata"->'tokenizationLink'->>'usedAt') IS NULL OR ("metadata"->'tokenizationLink'->>'usedAt') = '')
  `;

  if (!updated) {
    logger.error({
      customerId: customer.id,
      ...tokenMeta(token)
    }, "[Tokenization/Consume] Fallo actualizando token");
    return Response.json({ error: "token_ya_usado", mensaje: "No se pudo actualizar el token" }, { status: 409 });
  }

  logger.info({
    customerId: customer.id,
    ...tokenMeta(token),
    usedAt: now
  }, "[Tokenization/Consume] Token consumido exitosamente");
  return Response.json({ ok: true, customerId: customer.id, usedAt: now });
}
