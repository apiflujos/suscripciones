import express from "express";
import { prisma } from "../db/prisma";

export const publicTokenizationRouter = express.Router();

publicTokenizationRouter.get("/tokenization-links/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "missing_token" });

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: token } as any }
  });
  if (!customer) return res.status(404).json({ error: "token_not_found" });

  const meta: any = customer.metadata ?? {};
  const link = meta?.tokenizationLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  const usedAt = link?.usedAt ? new Date(link.usedAt) : null;

  const allowUsed = String((req.query as any)?.allowUsed || "").trim() === "1";
  if (usedAt && !allowUsed) return res.status(410).json({ error: "token_used" });
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ error: "token_expired" });
  }

  const templateId = String(link?.templateId || "").trim();
  const templateSlug = String(link?.templateSlug || "").trim();
  const template = templateId || templateSlug
    ? await prisma.publicCheckoutTemplate.findFirst({
        where: templateId ? { id: templateId } : { slug: templateSlug }
      })
    : null;

  res.json({
    ok: true,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email
    },
    link: {
      planId: link?.planId || null,
      kind: link?.kind || null,
      templateId: link?.templateId || null,
      templateSlug: link?.templateSlug || null
    },
    template: template
      ? {
          id: template.id,
          name: template.name,
          slug: template.slug,
          kind: template.kind,
          branding: template.branding || {},
          planId: template.planId || null
        }
      : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null
  });
});
