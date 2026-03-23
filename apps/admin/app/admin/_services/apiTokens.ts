import "server-only";

import crypto from "node:crypto";
import { prisma } from "@suscripciones/database";
import { sha256Hex } from "@suscripciones/core/lib/crypto";
import { getRolePermissions, Permission } from "../../../lib/rbac";
import { signJwt } from "../../../lib/jwt";

type TokenScope = "read" | "write";

function buildPermissions(scope: TokenScope): Permission[] {
  const base = getRolePermissions("ADMIN");
  if (scope === "read") return base.filter((p) => p.endsWith(":read"));
  return base;
}

export async function listApiTokens(tenantId: string) {
  return prisma.apiToken.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" }
  });
}

export async function createApiToken(input: {
  tenantId: string;
  name: string;
  scope: TokenScope;
  ttlHours: number;
}) {
  const name = String(input.name || "").trim().slice(0, 120) || "API token";
  const scope = input.scope === "read" ? "read" : "write";
  const maxHours = 24 * 365 * 10;
  const rawTtl = Math.trunc(input.ttlHours || 0);
  const ttlHours = rawTtl <= 0 ? maxHours : Math.min(rawTtl, maxHours);

  const tokenId = crypto.randomUUID();
  const permissions = buildPermissions(scope);
  const token = await signJwt({
    sub: `api:${tokenId}`,
    role: "ADMIN",
    tenantId: input.tenantId,
    permissions,
    tokenId
  } as any, { ttlSeconds: ttlHours * 60 * 60 });

  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await prisma.apiToken.create({
    data: {
      id: tokenId,
      tenantId: input.tenantId,
      name,
      tokenHash,
      permissions,
      expiresAt
    }
  });

  return { token, tokenId, expiresAt, permissions, name };
}

export async function revokeApiToken(input: { tenantId: string; id: string }) {
  const id = String(input.id || "").trim();
  if (!id) throw new Error("missing_id");
  const now = new Date();
  const res = await prisma.apiToken.updateMany({
    where: { id, tenantId: input.tenantId, revokedAt: null },
    data: { revokedAt: now }
  });
  if (res.count === 0) throw new Error("not_found");
  return res;
}
