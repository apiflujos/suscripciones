import { RetryJobType } from "@prisma/client";

/**
 * Qué fallos de envío no tiene sentido reintentar.
 *
 * Todo job nace con maxAttempts = 10 (el default del esquema). Para un fallo de
 * red eso está bien. Para una plantilla mal configurada o un teléfono repetido
 * son diez envíos idénticos condenados al mismo error: la configuración no
 * cambia sola en los cinco minutos del backoff.
 *
 * No es solo ruido. Meta mide la calidad del remitente, y los reintentos en
 * bucle son lo que alimentó el 131049 ("no entregado para mantener un ecosistema
 * sano") que ya estaba limitando las entregas.
 *
 * El sesgo de esta función es deliberado: ante la duda, reintentar. Un aviso
 * descartado de más se pierde en silencio; un reintento de más solo cuesta un
 * ciclo de worker. Por eso la lista de permanentes es corta y explícita en vez
 * de "todo 4xx": un 401 por token vencido o un 404 por cuenta mal configurada
 * son fallos del sistema, no del mensaje, y descartarlos borraría de golpe todos
 * los avisos de la cartera en vez de dejarlos esperando a que alguien lo arregle.
 */

// Solo los envíos al cliente. En el cobro un reintento no le cuesta reputación a
// nadie, así que ahí no se toca nada.
const MESSAGING_JOB_TYPES = new Set<RetryJobType>([
  RetryJobType.SEND_CHATWOOT_MESSAGE,
  RetryJobType.SUBSCRIPTION_REMINDER,
  RetryJobType.SEND_CAMPAIGN
]);

// Errores propios: los lanza este código antes de salir a la red. Son de
// configuración o de datos del cliente y ninguno se arregla repitiendo.
const PERMANENT_PREFIXES = [
  "missing_template_params", // la plantilla mapea una variable que viene vacía
  "customer_phone_required",
  "missing_customer_fields",
  "whatsapp_inbox_required",
  "attachment_url_invalid",
  "attachment_not_image",
  "attachment_too_large"
];

/**
 * Estados HTTP en los que el problema es el mensaje, no el sistema.
 *
 * 400: la petición está mal formada. 422: Chatwoot la entendió y la rechazó
 * —teléfono duplicado, formato de origen inválido—, que es el caso de los 42
 * rechazos en bucle sobre seis pares de clientes.
 *
 * Fuera quedan a propósito 401/403 (credenciales), 404 (cuenta o recurso mal
 * configurado), 408 y 429 (tiempo agotado y límite de peticiones) y todo 5xx:
 * esos sí cambian sin que nadie toque el mensaje.
 */
const PERMANENT_HTTP_STATUSES = new Set(["400", "422"]);

/**
 * Códigos con los que Meta dice "no lo voy a entregar", no "vuelve a intentar".
 * Se exigen delimitados para que el id de una conversación o un teléfono que
 * contenga esos dígitos por casualidad no descarte un mensaje recuperable.
 */
const PERMANENT_META_CODES = [
  131049, // limitado por calidad del remitente
  131026, // mensaje no entregable
  132000, // número de parámetros distinto al de la plantilla
  132001, // la plantilla no existe en ese idioma
  132007 // la plantilla está pausada o rechazada
];

function hasPermanentHttpStatus(message: string): boolean {
  // Los errores del cliente de Chatwoot llegan como
  //   "Chatwoot update contact failed: 422 {...}"
  const match = message.match(/failed:\s*(\d{3})\b/i);
  return match ? PERMANENT_HTTP_STATUSES.has(match[1]) : false;
}

function hasPermanentMetaCode(message: string): boolean {
  return PERMANENT_META_CODES.some((code) =>
    // "code":131049 / code: 131049 / (131049) — pero no dentro de un id largo.
    new RegExp(`(?<!\\d)${code}(?!\\d)`).test(message)
  );
}

/**
 * True si repetir el envío va a fallar exactamente igual.
 */
export function isPermanentMessagingError(args: { type: RetryJobType; message: unknown }): boolean {
  if (!MESSAGING_JOB_TYPES.has(args.type)) return false;

  const message = String(args.message ?? "").trim();
  if (!message) return false;

  const lower = message.toLowerCase();
  if (PERMANENT_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (hasPermanentHttpStatus(message)) return true;
  return hasPermanentMetaCode(message);
}
