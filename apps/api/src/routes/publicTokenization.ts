import express from "express";
import { prisma } from "../db/prisma";
import { getTenantBrand } from "../services/tenantBrand";

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
  const template = templateId
    ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } })
    : null;

  const tenant = await getTenantBrand(customer.tenantId || template?.tenantId || null);

  res.json({
    ok: true,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email
    },
    tenant,
    link: {
      planId: link?.planId || null,
      kind: link?.kind || null,
      templateId: link?.templateId || null,
      usedAt: usedAt ? usedAt.toISOString() : null
    },
    template: template
      ? {
          id: template.id,
          name: template.name,
          kind: template.kind,
          logoUrl: template.logoUrl || null,
          publicTitle: template.publicTitle || null,
          publicDescription: template.publicDescription || null,
          wompiTitle: template.wompiTitle || null,
          wompiDescription: template.wompiDescription || null,
          layout: template.layout || null
        }
      : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null
  });
});
