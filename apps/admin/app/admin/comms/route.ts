import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { RetryJobType } from "@prisma/client";
import { requireAdminToken } from "../_lib/requireAdminToken";
import { reqToCompat } from "../_lib/reqCompat";
import { computeSmartListRecipients } from "@suscripciones/core/services/smartList";
import { getSystemSmartList, getSystemSmartLists } from "@suscripciones/core/services/systemSmartLists";
import { CHATWOOT_CUSTOM_ATTR_DEFS, ensureChatwootCustomAttributes, syncChatwootAttributesForCustomer } from "@suscripciones/core/services/chatwootSync";
import { syncSmartListById } from "@suscripciones/core/services/smartListSync";
import { ChatwootClient } from "@suscripciones/core/providers/chatwoot/client";
import { getChatwootConfig } from "@suscripciones/core/services/runtimeConfig";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { getChatwootClient, matchesTenant, parseRules, slugifyLabel } from "./_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const smartListCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  rules: z.any()
});

const smartListUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  rules: z.any().optional()
});

const testConnectionSchema = z.object({
  baseUrl: z.string().url().optional(),
  accountId: z.number().int().positive().optional(),
  inboxId: z.number().int().positive().optional(),
  apiAccessToken: z.string().min(1).optional()
});

const campaignCreateSchema = z.object({
  name: z.string().min(1),
  smartListId: z.string().min(1).optional(),
  content: z.string().min(1),
  templateParams: z.record(z.any()).optional()
});

const campaignUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  templateParams: z.record(z.any()).optional(),
  smartListId: z.string().min(1).nullable().optional(),
  status: z.enum(["DRAFT", "RUNNING", "PAUSED", "COMPLETED", "FAILED"]).optional()
});

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const op = String(url.searchParams.get("op") || "").trim();
  if (op === "whatsapp_templates") {
    try {
      const client = await getChatwootClient();
      const templates = await client.listWhatsappTemplates();
      return Response.json({ ok: true, templates });
    } catch (err: any) {
      return Response.json({ ok: false, error: String(err?.message || "chatwoot_templates_failed") }, { status: 400 });
    }
  }
  return Response.json({ error: "not_found" }, { status: 404 });
}

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/admin\/comms\/?/, "");

  if (path.startsWith("smart-lists")) {
    const body = await req.json().catch(() => null);
    const parsed = smartListCreateSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

    const compatReq = reqToCompat(req, body);
    const tenantId = await getEffectiveTenantId(compatReq as any);
    if (!tenantId) return Response.json({ error: "tenant_required" }, { status: 400 });

    const rules = parseRules(parsed.data.rules);
    const chatwootLabel = slugifyLabel(parsed.data.name);

    const created = await prisma.smartList.create({
      data: {
        tenant: { connect: { id: tenantId } },
        name: parsed.data.name,
        description: parsed.data.description,
        enabled: parsed.data.enabled ?? true,
        rules: rules as any,
        chatwootLabel
      }
    });
    return Response.json({ smartList: created }, { status: 201 });
  }

  if (path.startsWith("test-connection")) {
    const body = await req.json().catch(() => null);
    const parsed = testConnectionSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

    const stored = await getChatwootConfig();
    const baseUrl = parsed.data.baseUrl || (stored.configured ? stored.baseUrl : "");
    const accountId = parsed.data.accountId || (stored.configured ? stored.accountId : 0);
    const inboxId = parsed.data.inboxId || (stored.configured ? stored.inboxId : 0);
    const apiAccessToken = parsed.data.apiAccessToken || (stored.configured ? stored.apiAccessToken : "");

    if (!baseUrl || !accountId || !inboxId || !apiAccessToken) {
      return Response.json({ error: "connection_not_configured" }, { status: 400 });
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
      return Response.json({
        ok: true,
        account: account.raw?.payload || account.raw || null,
        inbox: inbox.raw?.payload || inbox.raw || null
      });
    } catch (err: any) {
      return Response.json({ error: "connection_failed", message: String(err?.message || err) }, { status: 400 });
    }
  }

  if (path.startsWith("sync-attributes")) {
    const limitRaw = Number(url.searchParams.get("limit") ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 2000) : 200;
    const startedAt = new Date();

    await ensureChatwootCustomAttributes().catch(() => {});

    const customers = await prisma.customer.findMany({ orderBy: { createdAt: "desc" }, take: limit });
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
    return Response.json({
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
      limit,
      errors
    });
  }

  if (path.startsWith("bootstrap-attributes")) {
    let client: ChatwootClient;
    try {
      client = await getChatwootClient();
    } catch (err: any) {
      return Response.json({ error: err?.message || "chatwoot_not_configured" }, { status: 400 });
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

    return Response.json({ ok: true, results });
  }

  if (path.startsWith("campaigns")) {
    const body = await req.json().catch(() => null);
    const parsed = campaignCreateSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

    const compatReq = reqToCompat(req, body);
    const tenantId = await getEffectiveTenantId(compatReq as any);
    if (!tenantId) return Response.json({ error: "tenant_required" }, { status: 400 });

    const created = await prisma.campaign.create({
      data: {
        tenant: { connect: { id: tenantId } },
        name: parsed.data.name,
        ...(parsed.data.smartListId ? { smartList: { connect: { id: parsed.data.smartListId } } } : {}),
        content: parsed.data.content,
        templateParams: parsed.data.templateParams ?? undefined
      }
    });
    return Response.json({ campaign: created }, { status: 201 });
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}
