import "server-only";

import { z } from "zod";
import { prisma } from "@suscripciones/database";

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

export async function listCampaigns(args: { take?: number; skip?: number; ids?: string[] }) {
  const takeRaw = Number(args.take ?? 100);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 100;
  const skipRaw = Number(args.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const ids = Array.isArray(args.ids) ? args.ids.map((v) => String(v).trim()).filter(Boolean) : [];

  const where = ids.length ? { id: { in: ids } } : undefined;
  const [items, total] = await Promise.all([
    prisma.campaign.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
    prisma.campaign.count({ where })
  ]);
  return { ok: true as const, items, total };
}

export async function createCampaign(args: { tenantId?: string | null; input: unknown }) {
  const tenantId = String(args.tenantId || "").trim();
  if (!tenantId) return { ok: false as const, status: 400, error: "tenant_required" as const };

  const parsed = campaignCreateSchema.safeParse(args.input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const created = await prisma.campaign.create({
    data: {
      tenant: { connect: { id: tenantId } },
      name: parsed.data.name,
      ...(parsed.data.smartListId ? { smartList: { connect: { id: parsed.data.smartListId } } } : {}),
      content: parsed.data.content,
      templateParams: parsed.data.templateParams ?? undefined
    }
  });
  return { ok: true as const, campaign: created };
}

export async function getCampaignById(id: string) {
  const campaignId = String(id || "").trim();
  if (!campaignId) return { ok: false as const, status: 400, error: "invalid_id" as const };
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { ok: false as const, status: 404, error: "not_found" as const };
  return { ok: true as const, campaign };
}

export async function updateCampaign(args: { id: string; input: unknown }) {
  const campaignId = String(args.id || "").trim();
  if (!campaignId) return { ok: false as const, status: 400, error: "invalid_id" as const };

  const parsed = campaignUpdateSchema.safeParse(args.input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      name: parsed.data.name,
      content: parsed.data.content,
      templateParams: parsed.data.templateParams ?? undefined,
      smartListId: parsed.data.smartListId === null ? null : parsed.data.smartListId,
      status: parsed.data.status as any
    }
  });
  return { ok: true as const, campaign: updated };
}

export async function runCampaign(id: string) {
  const campaignId = String(id || "").trim();
  if (!campaignId) return { ok: false as const, status: 400, error: "invalid_id" as const };
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { ok: false as const, status: 404, error: "not_found" as const };

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "RUNNING", startedAt: campaign.startedAt ?? new Date(), lastError: null }
  });

  await prisma.retryJob.create({
    data: {
      type: "SEND_CAMPAIGN" as any,
      payload: { campaignId }
    }
  });

  return { ok: true as const };
}
