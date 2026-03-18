import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../../_lib/requireAdminToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const token = String(params?.token || "").trim();
  if (!token) {
    console.warn("[Tokenization/Consume] Token no proporcionado");
    return Response.json({ error: "token_no_proporcionado", mensaje: "El token es requerido" }, { status: 400 });
  }

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: token } as any }
  });
  if (!customer) {
    console.warn("[Tokenization/Consume] Token no encontrado", { token });
    return Response.json({ error: "token_no_encontrado", mensaje: "El token no está asociado a ningún customer" }, { status: 404 });
  }

  const meta: any = customer.metadata ?? {};
  const link = meta?.tokenizationLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  const usedAt = link?.usedAt ? new Date(link.usedAt) : null;

  if (usedAt) {
    console.warn("[Tokenization/Consume] Token ya fue usado", {
      customerId: customer.id,
      token,
      usedAt: usedAt.toISOString()
    });
    return Response.json(
      { error: "token_ya_usado", mensaje: "Este token ya fue consumido anteriormente", usedAt: usedAt.toISOString() },
      { status: 409 }
    );
  }

  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    console.warn("[Tokenization/Consume] Token expirado", {
      customerId: customer.id,
      token,
      expiresAt: expiresAt.toISOString(),
      now: new Date().toISOString(),
      expiredSince: Math.round((Date.now() - expiresAt.getTime()) / (1000 * 60 * 60)) + " horas"
    });
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
    console.error("[Tokenization/Consume] Fallo actualizando token", {
      customerId: customer.id,
      token
    });
    return Response.json({ error: "token_ya_usado", mensaje: "No se pudo actualizar el token" }, { status: 409 });
  }

  console.log("[Tokenization/Consume] Token consumido exitosamente", {
    customerId: customer.id,
    token,
    usedAt: now
  });
  return Response.json({ ok: true, customerId: customer.id, usedAt: now });
}
