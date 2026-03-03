import { PrismaClient } from "@prisma/client";

function withConnectionLimit(url?: string) {
  const raw = String(url || "").trim();
  if (!raw) return undefined;
  if (!/^postgres(ql)?:\/\//i.test(raw)) return raw;
  if (/[?&]connection_limit=/.test(raw)) return raw;
  const limitRaw = String(process.env.PRISMA_CONNECTION_LIMIT || process.env.DB_CONNECTION_LIMIT || "5").trim();
  const limit = Number(limitRaw);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 5;
  const sep = raw.includes("?") ? "&" : "?";
  return `${raw}${sep}connection_limit=${encodeURIComponent(String(safeLimit))}`;
}

const datasourceUrl = withConnectionLimit(process.env.DATABASE_URL);

export const prisma = datasourceUrl
  ? new PrismaClient({ datasources: { db: { url: datasourceUrl } } })
  : new PrismaClient();
