import { prisma } from "../db/prisma";

function normalize(v: unknown) {
  return String(v || "").trim();
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export function coerceTenantId(value: unknown): string | null {
  const raw = normalize(value);
  if (!raw || raw.toLowerCase() === "all") return null;
  return isUuid(raw) ? raw : null;
}

let cached: { tenantId: string | null; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function getDefaultTenantId(): Promise<string | null> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.tenantId;

  const envId =
    normalize(process.env.SA_APP_TENANT_ID) ||
    normalize(process.env.SA_TENANT_ID) ||
    normalize(process.env.SUPER_ADMIN_TENANT_ID);
  if (envId && isUuid(envId)) {
    cached = { tenantId: envId, at: now };
    return envId;
  }

  const name =
    normalize(process.env.SA_DEFAULT_TENANT_NAME) ||
    normalize(process.env.DEFAULT_TENANT_NAME) ||
    "Mercado de vinos";

  if (!name) {
    cached = { tenantId: null, at: now };
    return null;
  }

  const tenant = await prisma.saTenant.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  const tenantId = tenant?.id || null;
  cached = { tenantId, at: now };
  return tenantId;
}

export function readTenantIdFromReq(req: any): string | null {
  const raw =
    normalize(req?.query?.tenantId) ||
    normalize(req?.body?.tenantId) ||
    normalize(req?.header?.("x-tenant-id")) ||
    normalize(req?.headers?.["x-tenant-id"]);
  return coerceTenantId(raw);
}

export function readTenantIdsFromReq(req: any): string[] {
  const rawBody = req?.body?.tenantIds;
  const rawQuery = req?.query?.tenantIds;
  const rawSingle = readTenantIdFromReq(req);

  const out: string[] = [];
  const push = (v: any) => {
    const s = normalize(v);
    if (!s) return;
    if (s.toLowerCase() === "all") return;
    if (isUuid(s)) out.push(s);
  };

  if (Array.isArray(rawBody)) {
    for (const v of rawBody) push(v);
  } else if (typeof rawBody === "string") {
    for (const v of rawBody.split(",")) push(v);
  }

  if (Array.isArray(rawQuery)) {
    for (const v of rawQuery) push(v);
  } else if (typeof rawQuery === "string") {
    for (const v of rawQuery.split(",")) push(v);
  }

  if (rawSingle) push(rawSingle);

  return Array.from(new Set(out));
}

export async function getEffectiveTenantId(req: any): Promise<string | null> {
  const fromReq = readTenantIdFromReq(req);
  if (fromReq) return fromReq;
  return await getDefaultTenantId();
}

export async function getEffectiveTenantIds(req: any): Promise<string[]> {
  const ids = readTenantIdsFromReq(req);
  if (ids.length) return ids;
  const fallback = await getDefaultTenantId();
  return fallback ? [fallback] : [];
}
