import "server-only";

import { coerceTenantId, getDefaultTenantId } from "@suscripciones/core/services/tenantContext";

export async function resolveTenantId(input?: string | null) {
  const coerced = coerceTenantId(input);
  if (coerced !== null) return coerced;
  return await getDefaultTenantId();
}
