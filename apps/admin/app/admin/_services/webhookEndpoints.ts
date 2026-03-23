import "server-only";

import crypto from "node:crypto";
import { WebhookProvider } from "@prisma/client";
import { prisma } from "@suscripciones/database";
import { hashWebhookSecret } from "@suscripciones/core/services/webhookSecrets";

function normalizeName(value: string) {
  const v = String(value || "").trim();
  return v.slice(0, 120) || "Webhook";
}

function normalizeProvider(value: string | undefined): WebhookProvider {
  const v = String(value || "").trim().toUpperCase();
  if (v === "MERCADOPAGO") return WebhookProvider.MERCADOPAGO;
  return WebhookProvider.CUSTOM;
}

function normalizeActive(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  const v = String(value || "").trim().toLowerCase();
  if (!v) return true;
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

async function generateUniquePath() {
  for (let i = 0; i < 6; i += 1) {
    const path = `whk_${crypto.randomBytes(8).toString("hex")}`;
    const exists = await prisma.webhookEndpoint.findUnique({ where: { path } });
    if (!exists) return path;
  }
  throw new Error("path_generation_failed");
}

export async function listWebhookEndpoints(tenantId: string) {
  return prisma.webhookEndpoint.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" }
  });
}

export async function createWebhookEndpoint(input: {
  tenantId: string;
  name: string;
  provider?: string;
  secret: string;
  active?: string | boolean;
}) {
  const name = normalizeName(input.name);
  const provider = normalizeProvider(input.provider);
  const secretRaw = String(input.secret || "").trim();
  if (!secretRaw) throw new Error("secret_required");
  const active = normalizeActive(input.active);
  const path = await generateUniquePath();
  const { salt, hash } = hashWebhookSecret(secretRaw);

  return prisma.webhookEndpoint.create({
    data: {
      tenantId: input.tenantId,
      name,
      provider,
      path,
      secretHash: hash,
      secretSalt: salt,
      active
    }
  });
}

export async function updateWebhookEndpoint(input: {
  tenantId: string;
  id: string;
  name?: string;
  provider?: string;
  secret?: string;
  active?: string | boolean;
}) {
  const id = String(input.id || "").trim();
  if (!id) throw new Error("missing_id");
  const data: any = {};

  if (input.name != null) {
    const name = normalizeName(String(input.name || ""));
    if (name) data.name = name;
  }

  if (input.provider != null) {
    data.provider = normalizeProvider(input.provider);
  }

  if (input.active != null) {
    data.active = normalizeActive(input.active);
  }

  if (input.secret != null) {
    const secretRaw = String(input.secret || "").trim();
    if (!secretRaw) throw new Error("secret_required");
    const { salt, hash } = hashWebhookSecret(secretRaw);
    data.secretSalt = salt;
    data.secretHash = hash;
  }

  const res = await prisma.webhookEndpoint.updateMany({
    where: { id, tenantId: input.tenantId },
    data
  });
  if (res.count === 0) throw new Error("not_found");
  return prisma.webhookEndpoint.findFirst({ where: { id, tenantId: input.tenantId } });
}

export async function deleteWebhookEndpoint(input: { tenantId: string; id: string }) {
  const id = String(input.id || "").trim();
  if (!id) throw new Error("missing_id");
  const res = await prisma.webhookEndpoint.deleteMany({
    where: { id, tenantId: input.tenantId }
  });
  if (res.count === 0) throw new Error("not_found");
  return res;
}
