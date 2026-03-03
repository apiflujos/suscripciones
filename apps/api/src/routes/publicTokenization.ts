import express from "express";
import { prisma } from "../db/prisma";
import { LogLevel } from "@prisma/client";
import { getTenantBrand } from "../services/tenantBrand";
import { systemLog } from "../services/systemLog";
import { tokenMeta } from "../lib/tokenMeta";

export const publicTokenizationRouter = express.Router();

type TokenizationLinkMeta = {
  token?: string;
  expiresAt?: string;
  usedAt?: string;
  templateId?: string;
  planId?: string;
  kind?: string;
  tenantId?: string;
};

publicTokenizationRouter.get("/tokenization-links/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "missing_token" });
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  const ip = String((req.headers["x-forwarded-for"] as string) || req.ip || "").split(",")[0].trim();

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: token } as any }
  });
  if (!customer) {
    void systemLog(LogLevel.WARN, "public.tokenization_link", "tokenization_token_not_found", {
      ...tokenMeta(token),
      ip,
      userAgent: req.get("user-agent") || null
    }).catch(() => {});
    return res.status(404).json({ error: "token_not_found" });
  }

  const meta = (customer.metadata ?? {}) as { tokenizationLink?: TokenizationLinkMeta };
  const link = meta?.tokenizationLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  const usedAt = link?.usedAt ? new Date(link.usedAt) : null;

  const allowUsed = String((req.query as Record<string, unknown>)?.allowUsed || "").trim() === "1";
  if (usedAt && !allowUsed) {
    void systemLog(LogLevel.WARN, "public.tokenization_link", "tokenization_token_used", {
      ...tokenMeta(token),
      customerId: customer.id,
      customerName: customer.name || null,
      customerEmail: customer.email || null,
      customerPhone: customer.phone || null,
      tenantId: customer.tenantId,
      planId: link?.planId || null,
      templateId: link?.templateId || null,
      kind: link?.kind || null,
      usedAt: usedAt.toISOString(),
      ip,
      userAgent: req.get("user-agent") || null
    }).catch(() => {});
    return res.status(410).json({ error: "token_used" });
  }
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    void systemLog(LogLevel.WARN, "public.tokenization_link", "tokenization_token_expired", {
      ...tokenMeta(token),
      customerId: customer.id,
      customerName: customer.name || null,
      customerEmail: customer.email || null,
      customerPhone: customer.phone || null,
      tenantId: customer.tenantId,
      planId: link?.planId || null,
      templateId: link?.templateId || null,
      kind: link?.kind || null,
      expiresAt: expiresAt.toISOString(),
      ip,
      userAgent: req.get("user-agent") || null
    }).catch(() => {});
    return res.status(410).json({ error: "token_expired" });
  }

  const templateId = String(link?.templateId || "").trim();
  const template = templateId
    ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } })
    : null;

  const tenantFromLink = link?.tenantId ? String(link.tenantId) : null;
  const tenant = await getTenantBrand(template?.tenantId || tenantFromLink || customer.tenantId || null);

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
