import { consumeLimitOrBlock } from "./superAdminConsume";

function normalize(v: unknown) {
  const s = String(v || "").trim();
  return s || "";
}

export function getSaAppTenantId(): string {
  return (
    normalize(process.env.SA_APP_TENANT_ID) ||
    normalize(process.env.SA_TENANT_ID) ||
    normalize(process.env.SUPER_ADMIN_TENANT_ID) ||
    ""
  );
}

export async function consumeApp(serviceKey: string, args: { amount?: number; source?: string; meta?: any }) {
  const tenantId = getSaAppTenantId();
  if (!tenantId) return;
  await consumeLimitOrBlock(serviceKey, { tenantId, amount: args.amount, source: args.source, meta: args.meta }).catch(() => {});
}

