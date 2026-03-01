import { prisma } from "../db/prisma";

export type ModuleAccess = {
  enabled: boolean;
  reason: null | "tenant_missing" | "module_missing" | "module_inactive" | "module_disabled";
};

export async function getModuleAccess(tenantId: string | null, moduleKey: string): Promise<ModuleAccess> {
  const key = String(moduleKey || "").trim();
  if (!key) return { enabled: true, reason: null };
  if (!tenantId) return { enabled: false, reason: "tenant_missing" };

  const def = await prisma.saModuleDefinition.findUnique({ where: { key } });
  if (!def) return { enabled: false, reason: "module_missing" };
  if (!def.active) return { enabled: false, reason: "module_inactive" };

  const toggle = await prisma.saTenantModuleToggle.findUnique({
    where: { tenantId_moduleKey: { tenantId, moduleKey: key } }
  });
  if (!toggle) return { enabled: true, reason: null };
  return toggle.enabled ? { enabled: true, reason: null } : { enabled: false, reason: "module_disabled" };
}
