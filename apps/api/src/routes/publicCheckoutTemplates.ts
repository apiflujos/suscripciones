import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { PlanType, PublicCheckoutKind } from "@prisma/client";

const templateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  kind: z.nativeEnum(PublicCheckoutKind),
  active: z.boolean().optional(),
  planId: z.string().uuid().optional().nullable(),
  allowPlanSelect: z.boolean().optional(),
  requireShipping: z.boolean().optional(),
  requireAddress: z.boolean().optional(),
  branding: z.any().optional(),
  layout: z.any().optional()
});

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

async function ensureUniqueSlug(base: string) {
  let candidate = base || "checkout";
  let suffix = 1;
  while (true) {
    const existing = await prisma.publicCheckoutTemplate.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

async function validatePlan(kind: PublicCheckoutKind, planId?: string | null) {
  if (!planId) return null;
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) return null;
  if (kind === PublicCheckoutKind.PLAN && plan.planType !== PlanType.manual_link) return null;
  if (kind === PublicCheckoutKind.SUBSCRIPTION && plan.planType !== PlanType.auto_subscription) return null;
  return plan;
}

export const publicCheckoutTemplatesRouter = express.Router();

publicCheckoutTemplatesRouter.get("/templates", async (_req, res) => {
  const req = _req as any;
  const takeRaw = Number(req?.query?.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const items = await prisma.publicCheckoutTemplate.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: { plan: true }
  });
  res.json({ items });
});

publicCheckoutTemplatesRouter.post("/templates", async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const data = parsed.data;
  const baseSlug = slugify(data.slug || data.name);
  const slug = await ensureUniqueSlug(baseSlug || "checkout");
  const plan = await validatePlan(data.kind, data.planId || undefined);

  if (data.allowPlanSelect !== true && !plan) {
    return res.status(400).json({ error: "plan_required" });
  }
  if (data.planId && !plan) {
    return res.status(400).json({ error: "plan_not_found_or_invalid" });
  }

  const created = await prisma.publicCheckoutTemplate.create({
    data: {
      name: data.name,
      slug,
      kind: data.kind,
      active: data.active ?? true,
      planId: plan ? plan.id : null,
      allowPlanSelect: data.allowPlanSelect ?? false,
      requireShipping: data.requireShipping ?? false,
      requireAddress: data.requireAddress ?? false,
      branding: data.branding ?? {},
      layout: data.layout ?? null
    },
    include: { plan: true }
  });

  res.status(201).json({ template: created });
});

publicCheckoutTemplatesRouter.put("/templates/:id", async (req, res) => {
  const templateId = String(req.params.id || "").trim();
  if (!templateId) return res.status(400).json({ error: "invalid_id" });

  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const data = parsed.data;
  const existing = await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } });
  if (!existing) return res.status(404).json({ error: "template_not_found" });

  const slug = data.slug ? slugify(data.slug) : existing.slug;
  if (slug !== existing.slug) {
    const unique = await ensureUniqueSlug(slug);
    if (unique !== slug) return res.status(409).json({ error: "slug_taken" });
  }

  const plan = await validatePlan(data.kind, data.planId || undefined);
  if (data.allowPlanSelect !== true && !plan && data.planId !== null) {
    return res.status(400).json({ error: "plan_required" });
  }
  if (data.planId && !plan) {
    return res.status(400).json({ error: "plan_not_found_or_invalid" });
  }

  const updated = await prisma.publicCheckoutTemplate.update({
    where: { id: templateId },
    data: {
      name: data.name,
      slug,
      kind: data.kind,
      active: data.active ?? existing.active,
      planId: plan ? plan.id : data.allowPlanSelect ? null : existing.planId,
      allowPlanSelect: data.allowPlanSelect ?? existing.allowPlanSelect,
      requireShipping: data.requireShipping ?? existing.requireShipping,
      requireAddress: data.requireAddress ?? existing.requireAddress,
      branding: data.branding ?? existing.branding,
      layout: data.layout ?? existing.layout
    },
    include: { plan: true }
  });

  res.json({ template: updated });
});

publicCheckoutTemplatesRouter.delete("/templates/:id", async (req, res) => {
  const templateId = String(req.params.id || "").trim();
  if (!templateId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } });
  if (!existing) return res.status(404).json({ error: "template_not_found" });
  await prisma.publicCheckoutTemplate.update({ where: { id: templateId }, data: { active: false } });
  res.json({ ok: true });
});
