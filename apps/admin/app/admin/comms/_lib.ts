import { ChatwootClient } from "@suscripciones/core/providers/chatwoot/client";
import { getChatwootConfig } from "@suscripciones/core/services/runtimeConfig";
import type { SmartListRule } from "@suscripciones/core/services/smartList";

export function slugifyLabel(name: string) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `list_${base || "unnamed"}`;
}

export function parseRules(input: any): SmartListRule {
  if (!input || typeof input !== "object") {
    return { op: "and", rules: [] } as any;
  }
  return input as SmartListRule;
}

export function matchesTenant(customer: any, tenantId: string) {
  if (!tenantId) return true;
  if (String(customer?.tenantId || "") === tenantId) return true;
  const links = Array.isArray(customer?.tenantLinks) ? customer.tenantLinks : [];
  return links.some((link: any) => String(link?.tenantId || "") === tenantId);
}

export async function getChatwootClient() {
  const cfg = await getChatwootConfig();
  if (!cfg.configured) throw new Error("chatwoot_not_configured");
  return new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });
}
