import "server-only";

import { ChatwootClient } from "@suscripciones/core/providers/chatwoot/client";
import { getChatwootConfig } from "@suscripciones/core/services/runtimeConfig";
import { logger } from "@suscripciones/core/lib/logger";

/**
 * Plantillas de WhatsApp aprobadas, con sus `components` (el BODY trae el texto
 * con los marcadores {{1}}, {{2}}…). Se usan para reconstruir el mensaje que
 * recibió cada cliente, ya que sólo guardamos los parámetros con los que se
 * envió y no el texto final.
 *
 * Nunca lanza: si Chatwoot no responde, el historial de mensajes debe seguir
 * viéndose aunque sea sin el cuerpo de la plantilla.
 */
export async function listWhatsappTemplatesSafe(): Promise<any[]> {
  try {
    const cfg = await getChatwootConfig();
    if (!cfg.configured) return [];
    const client = new ChatwootClient({
      baseUrl: cfg.baseUrl,
      accountId: cfg.accountId,
      apiAccessToken: cfg.apiAccessToken,
      inboxId: cfg.inboxId
    });
    const { templates } = await client.listWhatsappTemplates();
    return Array.isArray(templates) ? templates : [];
  } catch (err) {
    logger.warn({ err }, "whatsappTemplates: no se pudieron listar las plantillas");
    return [];
  }
}
