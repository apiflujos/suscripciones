import { z } from "zod";
import { getPublicBaseUrlFromEnv, normalizePublicUrl } from "./publicBase";

/**
 * Los enlaces que se le mandan al cliente tienen que ser NUESTROS.
 *
 * Las rutas que agendan avisos reciben la URL en el cuerpo de la petición y la
 * pasan tal cual a una plantilla de WhatsApp. `normalizePublicUrl` solo descarta
 * localhost, así que cualquier dominio pasaba: con un token de integración se
 * podía hacer que el número de WhatsApp del negocio enviara a los clientes un
 * enlace a donde fuera, dentro de una plantilla de cobro que parece legítima.
 *
 * No es solo el fraude al cliente. Meta ya está limitando las entregas por
 * calidad del remitente (el 131049 de la auditoría); mandar enlaces a dominios
 * ajenos desde una plantilla de pago es la vía rápida a que bloqueen el número.
 *
 * Estos enlaces los genera esta misma aplicación —checkout público, tokenización,
 * catálogo—, así que siempre viven bajo su base pública. Exigirlo no restringe
 * nada legítimo.
 */

/** Compara host y puerto; el esquema ya lo fuerza `normalizePublicUrl`. */
function mismaBase(url: URL, base: URL): boolean {
  if (url.host !== base.host) return false;
  // Un subdominio distinto no es la misma base: `pagos.mdv.com` ≠ `mdv.com`.
  return true;
}

export type ResultadoEnlace =
  | { ok: true; url: string }
  | { ok: false; motivo: "vacio" | "invalido" | "dominio_no_permitido" };

export function validarEnlacePublicoPropio(raw: unknown): ResultadoEnlace {
  const normalizada = normalizePublicUrl(typeof raw === "string" ? raw : "");
  if (!normalizada) {
    const vacio = !String(raw ?? "").trim();
    return { ok: false, motivo: vacio ? "vacio" : "invalido" };
  }

  const baseCruda = getPublicBaseUrlFromEnv();
  // Sin base pública configurada no hay contra qué comparar. Se deja pasar el
  // enlace ya normalizado en vez de bloquear todos los avisos de un entorno mal
  // configurado, pero es una carencia de configuración, no un permiso.
  if (!baseCruda) return { ok: true, url: normalizada };

  try {
    if (!mismaBase(new URL(normalizada), new URL(baseCruda))) {
      return { ok: false, motivo: "dominio_no_permitido" };
    }
  } catch {
    return { ok: false, motivo: "invalido" };
  }

  return { ok: true, url: normalizada };
}

/** Campo de Zod para una URL pública propia. */
export const enlacePublicoPropioSchema = z
  .string()
  .min(1)
  .superRefine((valor, ctx) => {
    const resultado = validarEnlacePublicoPropio(valor);
    if (resultado.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        resultado.motivo === "dominio_no_permitido"
          ? "La URL no pertenece al dominio público de la aplicación."
          : "La URL no es válida."
    });
  })
  .transform((valor) => {
    const resultado = validarEnlacePublicoPropio(valor);
    return resultado.ok ? resultado.url : valor;
  });

/** Identificador opcional: cadena vacía se trata como ausente. */
const idOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

export const agendarTokenizacionSchema = z.object({
  customerId: z.string().trim().min(1, "customerId requerido"),
  tokenUrl: enlacePublicoPropioSchema,
  tenantId: idOpcional,
  planId: idOpcional,
  productId: idOpcional
});

export const agendarCatalogoSchema = z.object({
  customerId: z.string().trim().min(1, "customerId requerido"),
  catalogUrl: enlacePublicoPropioSchema,
  tenantId: idOpcional,
  planId: idOpcional,
  productId: idOpcional
});
