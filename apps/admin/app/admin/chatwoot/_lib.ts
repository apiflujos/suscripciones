import { ChatwootClient } from "@suscripciones/core/providers/chatwoot/client";
import { getChatwootConfig } from "@suscripciones/core/services/runtimeConfig";

export async function getClientOrThrow() {
  const cfg = await getChatwootConfig();
  if (!cfg.configured) throw new Error("chatwoot_not_configured");
  return new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });
}

export function sanitizeChatwootContent(content: string, attachmentUrl?: string | null) {
  const safe = String(content || "");
  const target = String(attachmentUrl || "").trim();
  const lines = safe.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^imagen\s*:/i.test(trimmed)) return false;
    if (/data:image\//i.test(trimmed)) return false;
    if (target && trimmed.includes(target)) return false;
    return true;
  });
  const normalized = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalized || safe.trim();
}

export const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
