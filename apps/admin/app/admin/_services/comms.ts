import "server-only";

import { prisma } from "@suscripciones/database";
import { ChatwootClient } from "@suscripciones/core/providers/chatwoot/client";
import { getChatwootConfig } from "@suscripciones/core/services/runtimeConfig";
import { CHATWOOT_CUSTOM_ATTR_DEFS, ensureChatwootCustomAttributes, syncChatwootAttributesForCustomer } from "@suscripciones/core/services/chatwootSync";
import { getChatwootClient } from "../comms/_lib";

export async function syncContactsAttributes(limit: number) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 2000) : 200;
  const startedAt = new Date();

  await ensureChatwootCustomAttributes().catch(() => {});

  const customers = await prisma.customer.findMany({ orderBy: { createdAt: "desc" }, take: safeLimit });
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ customerId: string; error: string }> = [];
  for (const c of customers) {
    const out = await syncChatwootAttributesForCustomer(c.id).catch((err) =>
      ({ ok: false, reason: err?.message ? String(err.message) : "sync_failed" } as any)
    );
    if (out?.ok && out?.skipped) skipped += 1;
    else if (out?.ok) synced += 1;
    else {
      failed += 1;
      if (errors.length < 20) {
        errors.push({ customerId: c.id, error: String(out?.reason || "sync_failed") });
      }
    }
  }
  const processed = synced + failed + skipped;
  return {
    ok: true,
    module: "sincronizacion_contactos",
    platform: "Chatwoot",
    sourceLabel: "Contactos de ApiFlujos",
    targetLabel: "Contactos y atributos personalizados en Chatwoot",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    synced,
    failed,
    skipped,
    processed,
    limit: safeLimit,
    errors
  };
}

export async function testChatwootConnection(input: {
  baseUrl?: string;
  accountId?: number;
  inboxId?: number;
  apiAccessToken?: string;
}) {
  const stored = await getChatwootConfig();
  const baseUrl = input.baseUrl || (stored.configured ? stored.baseUrl : "");
  const accountId = input.accountId || (stored.configured ? stored.accountId : 0);
  const inboxId = input.inboxId || (stored.configured ? stored.inboxId : 0);
  const apiAccessToken = input.apiAccessToken || (stored.configured ? stored.apiAccessToken : "");

  if (!baseUrl || !accountId || !inboxId || !apiAccessToken) {
    return { ok: false as const, status: 400, error: "connection_not_configured" as const };
  }

  try {
    const client = new ChatwootClient({
      baseUrl,
      accountId,
      apiAccessToken,
      inboxId
    });

    const account = await client.getAccount();
    const inbox = await client.getInbox(inboxId);
    return {
      ok: true as const,
      account: account.raw?.payload || account.raw || null,
      inbox: inbox.raw?.payload || inbox.raw || null
    };
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "connection_failed" as const, message: String(err?.message || err) };
  }
}

export async function bootstrapChatwootAttributes() {
  let client: ChatwootClient;
  try {
    client = await getChatwootClient();
  } catch (err: any) {
    return { ok: false as const, status: 400, error: err?.message || "chatwoot_not_configured" };
  }

  const defs = CHATWOOT_CUSTOM_ATTR_DEFS;
  const results: Array<{ key: string; ok: boolean; error?: string }> = [];
  for (const def of defs) {
    try {
      await client.createCustomAttribute({ ...def, model: "contact" });
      results.push({ key: def.key, ok: true });
    } catch (err: any) {
      results.push({ key: def.key, ok: false, error: err?.message ? String(err.message) : "failed" });
    }
  }

  return { ok: true as const, results };
}
