import { GamificationEntityType, LogLevel, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ChatwootClient } from "../providers/chatwoot/client";
import { getChatwootConfig } from "./runtimeConfig";
import { systemLog } from "./systemLog";
import { logger } from "../lib/logger";
import { applyGamificationEvent } from "./gamification";
import { GAMIFICATION_PENALTIES } from "./gamificationConfig";
import { getGamificationConfig } from "./gamificationSettings";

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

function minutesDiff(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / 60000);
}

function normalizeMessage(input?: string | null) {
  const text = String(input || "").trim();
  if (text) return text;
  return "Hola, ¿quieres que te ayudemos con tu compra o suscripción?";
}

type FollowupTemplateConfig = {
  templateName?: string;
  templateLang?: string;
  templateParams?: Record<string, unknown>;
  processed_params?: Record<string, unknown>;
};

type ChatwootMeta = {
  contactId?: number | string;
  lastOutgoingAt?: string | number;
  lastIncomingAt?: string | number;
  lastFollowupAt?: string | number;
  lastConversationId?: number | string;
  followupCount?: number;
  followupMaxedAt?: string | number | null;
  followup?: FollowupTemplateConfig & { message?: string };
};

type GamificationMeta = {
  followup?: FollowupTemplateConfig & { message?: string };
};

type CustomerMetadata = Record<string, unknown> & {
  chatwoot?: ChatwootMeta;
  gamification?: GamificationMeta;
};

type TenantGamificationMeta = {
  gamification?: {
    followupMinutes?: number;
    followupCooldownMinutes?: number;
    followupMaxAttempts?: number;
  };
};

function resolveTemplate(meta: CustomerMetadata) {
  const cfg = meta?.gamification?.followup || meta?.chatwoot?.followup || {};
  const templateName = String(cfg?.templateName || "").trim();
  const templateLang = String(cfg?.templateLang || "").trim();
  const templateParams = cfg?.templateParams || cfg?.processed_params || null;
  return {
    templateName: templateName || null,
    templateLang: templateLang || null,
    templateParams
  };
}

function resolveThresholds(
  payload: { followupMinutes?: number; cooldownMinutes?: number; maxCustomers?: number; maxFollowups?: number } | null,
  cfg?: { followup?: { minutes?: number; cooldownMinutes?: number; maxAttempts?: number; penaltyNoResponse?: number } }
) {
  const minutes = Number(payload?.followupMinutes ?? process.env.CHATWOOT_FOLLOWUP_MINUTES ?? 15);
  const cooldown = Number(payload?.cooldownMinutes ?? process.env.CHATWOOT_FOLLOWUP_COOLDOWN_MINUTES ?? 120);
  const max = Number(payload?.maxCustomers ?? process.env.CHATWOOT_FOLLOWUP_MAX_CUSTOMERS ?? 200);
  const maxFollowups = Number(payload?.maxFollowups ?? process.env.CHATWOOT_FOLLOWUP_MAX_ATTEMPTS ?? 3);
  const cfgMinutes = Number(cfg?.followup?.minutes ?? NaN);
  const cfgCooldown = Number(cfg?.followup?.cooldownMinutes ?? NaN);
  const cfgMaxAttempts = Number(cfg?.followup?.maxAttempts ?? NaN);
  const cfgPenalty = Number(cfg?.followup?.penaltyNoResponse ?? NaN);
  return {
    followupMinutes: Number.isFinite(cfgMinutes)
      ? Math.max(5, Math.trunc(cfgMinutes))
      : Number.isFinite(minutes)
        ? Math.max(5, Math.trunc(minutes))
        : 15,
    cooldownMinutes: Number.isFinite(cfgCooldown)
      ? Math.max(15, Math.trunc(cfgCooldown))
      : Number.isFinite(cooldown)
        ? Math.max(15, Math.trunc(cooldown))
        : 120,
    maxCustomers: Number.isFinite(max) ? Math.max(10, Math.trunc(max)) : 200,
    maxFollowups: Number.isFinite(cfgMaxAttempts)
      ? Math.max(1, Math.trunc(cfgMaxAttempts))
      : Number.isFinite(maxFollowups)
        ? Math.max(1, Math.trunc(maxFollowups))
        : 3,
    penaltyNoResponse: Number.isFinite(cfgPenalty) ? Math.max(0, Math.trunc(cfgPenalty)) : GAMIFICATION_PENALTIES.noResponse
  };
}

async function resolveConversationId(client: ChatwootClient, contactId: number) {
  const list = await client.listContactConversations(contactId).catch(() => null);
  const raw = list && typeof list === "object" ? (list as { raw?: { payload?: unknown } }).raw : null;
  const payload = raw && Array.isArray(raw.payload) ? raw.payload : [];
  const items = Array.isArray(payload) ? payload : [];
  if (!items.length) return null;
  const open = items.find((c) => {
    if (!c || typeof c !== "object") return false;
    const status = String((c as Record<string, unknown>).status || "").toLowerCase();
    return status === "open";
  }) || items[0];
  const openRecord = open && typeof open === "object" ? (open as Record<string, unknown>) : {};
  const id = Number(openRecord.id || openRecord.conversation_id || openRecord.conversationId);
  return Number.isFinite(id) ? id : null;
}

export async function chatwootFollowupTrainer(payload: { followupMinutes?: number; cooldownMinutes?: number; maxCustomers?: number; maxFollowups?: number } | null) {
  const cfg = await getChatwootConfig();
  if (!cfg.configured) {
    await systemLog(LogLevel.WARN, "data_trainer", "Chatwoot no configurado", {}).catch((err) => {
      logger.warn({ err }, '[ChatwootTrainer] Fallo creando systemLog');
    });
    return { processed: 0, nudged: 0, skipped: 0, reason: "chatwoot_not_configured" };
  }

  const globalCfg = await getGamificationConfig().catch(() => null);
  const { followupMinutes, cooldownMinutes, maxCustomers, maxFollowups, penaltyNoResponse } = resolveThresholds(payload, globalCfg || undefined);
  const now = new Date();

  const customers = await prisma.customer.findMany({
    take: maxCustomers,
    orderBy: { updatedAt: "desc" }
  });

  const tenantIds = Array.from(new Set(customers.map((c) => String(c.tenantId || "")).filter(Boolean)));
  const tenants = tenantIds.length
    ? await prisma.saTenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, metadata: true } })
    : [];
  const tenantConfig = new Map<string, TenantGamificationMeta>();
  tenants.forEach((t) => tenantConfig.set(String(t.id), (t.metadata || {}) as TenantGamificationMeta));

  const client = new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });

  let nudged = 0;
  let processed = 0;
  let skipped = 0;

  for (const customer of customers) {
    processed += 1;
    const meta = (customer.metadata || {}) as CustomerMetadata;
    const chat = meta.chatwoot || {};
    const contactId = Number(chat.contactId || 0);
    if (!Number.isFinite(contactId) || contactId <= 0) {
      skipped += 1;
      continue;
    }

    const lastOutgoingAt = toDate(chat.lastOutgoingAt) || null;
    const lastIncomingAt = toDate(chat.lastIncomingAt) || null;
    const lastFollowupAt = toDate(chat.lastFollowupAt) || null;
    const followupCount = Number(chat.followupCount || 0);
    const followupMaxedAt = toDate(chat.followupMaxedAt) || null;
    const tenantMeta = customer.tenantId ? tenantConfig.get(String(customer.tenantId)) : null;
    const tenantFollowup = tenantMeta?.gamification || {};
    const effectiveFollowupMinutes = Number(tenantFollowup?.followupMinutes);
    const effectiveCooldownMinutes = Number(tenantFollowup?.followupCooldownMinutes);
    const effectiveMaxAttempts = Number(tenantFollowup?.followupMaxAttempts);
    const followupMinutesEffective = Number.isFinite(effectiveFollowupMinutes) && effectiveFollowupMinutes > 0 ? effectiveFollowupMinutes : followupMinutes;
    const cooldownMinutesEffective = Number.isFinite(effectiveCooldownMinutes) && effectiveCooldownMinutes > 0 ? effectiveCooldownMinutes : cooldownMinutes;
    const maxFollowupsEffective = Number.isFinite(effectiveMaxAttempts) && effectiveMaxAttempts > 0 ? effectiveMaxAttempts : maxFollowups;
    if (!lastOutgoingAt) {
      skipped += 1;
      continue;
    }

    const minutesSinceOutgoing = minutesDiff(now, lastOutgoingAt);
    if (minutesSinceOutgoing < followupMinutesEffective) {
      skipped += 1;
      continue;
    }

    if (lastIncomingAt && lastIncomingAt.getTime() >= lastOutgoingAt.getTime()) {
      skipped += 1;
      continue;
    }

    if (lastFollowupAt && minutesDiff(now, lastFollowupAt) < cooldownMinutesEffective) {
      skipped += 1;
      continue;
    }
    if (followupCount >= maxFollowupsEffective) {
      if (!followupMaxedAt) {
        const nextMeta = {
          ...(meta && typeof meta === "object" ? meta : {}),
          chatwoot: {
            ...(chat || {}),
            followupMaxedAt: now.toISOString()
          }
        };
        await prisma.customer.update({
          where: { id: customer.id },
          data: { metadata: nextMeta as Prisma.InputJsonValue }
        }).catch((err) => {
          logger.warn({ err, customerId: customer.id }, '[ChatwootTrainer] Fallo actualizando customer');
        });
        await applyGamificationEvent({
          entityType: GamificationEntityType.CUSTOMER,
          entityId: customer.id,
          tenantId: customer.tenantId || null,
          kind: "conversation.no_response",
          statusDelta: -Math.abs(penaltyNoResponse),
          lifetimeDelta: 0,
          rewardDelta: 0,
          metadata: { reason: "max_followups_reached", followupCount, maxAttempts: maxFollowupsEffective }
        }).catch((err) => {
          logger.warn({ err, customerId: customer.id }, '[ChatwootTrainer] Fallo aplicando gamificación');
        });
      }
      skipped += 1;
      continue;
    }

    const convIdFromMeta = Number(chat.lastConversationId || 0);
    const conversationId = Number.isFinite(convIdFromMeta) && convIdFromMeta > 0
      ? convIdFromMeta
      : await resolveConversationId(client, contactId);

    if (!conversationId) {
      skipped += 1;
      continue;
    }

    const tpl = resolveTemplate(meta);
    const message = normalizeMessage(meta?.gamification?.followup?.message || meta?.chatwoot?.followup?.message);

    try {
      if (tpl.templateName && tpl.templateLang) {
        await client.sendTemplate(conversationId, {
          content: message,
          templateParams: {
            name: tpl.templateName,
            language: tpl.templateLang,
            processed_params: tpl.templateParams || {}
          }
        });
      } else {
        await client.sendMessage(conversationId, message);
      }

      const nextMeta = {
        ...(meta && typeof meta === "object" ? meta : {}),
        chatwoot: {
          ...(chat || {}),
          lastFollowupAt: now.toISOString(),
          lastFollowupConversationId: conversationId,
          followupCount: followupCount + 1
        }
      };
      await prisma.customer.update({
        where: { id: customer.id },
        data: { metadata: nextMeta as Prisma.InputJsonValue }
      }).catch((err) => {
        logger.warn({ err, customerId: customer.id }, '[ChatwootTrainer] Fallo actualizando customer');
      });

      await applyGamificationEvent({
        entityType: GamificationEntityType.CUSTOMER,
        entityId: customer.id,
        tenantId: customer.tenantId || null,
        kind: "conversation.followup_sent",
        statusDelta: 0,
        lifetimeDelta: 0,
        rewardDelta: 0,
        metadata: { conversationId, minutesSinceOutgoing }
      }).catch((err) => {
        logger.warn({ err, customerId: customer.id }, '[ChatwootTrainer] Fallo aplicando gamificación');
      });

      nudged += 1;
    } catch (err: any) {
      await systemLog(LogLevel.WARN, "data_trainer", "Followup fallido", {
        customerId: customer.id,
        conversationId,
        err: String(err?.message || err)
      }).catch((logErr) => {
        logger.warn({ logErr, customerId: customer.id }, '[ChatwootTrainer] Fallo creando systemLog');
      });
    }
  }

  return { processed, nudged, skipped, followupMinutes, cooldownMinutes };
}
