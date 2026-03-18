"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import { createTenant as createTenantService, updateTenant as updateTenantService, deleteTenant as deleteTenantService } from "../admin/_services/tenants";

function mergeQuery(path: string, extra: Record<string, string | undefined>) {
  const url = new URL(path || "/", "http://localhost");
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

export async function createTenant(formData: FormData) {
  await assertCsrfToken(formData);
  const name = String(formData.get("name") || "").trim();
  const logoUrl = String(formData.get("logoUrl") || "").trim();
  const returnTo = String(formData.get("returnTo") || "").trim() || "/";
  if (!name) return redirect(mergeQuery(returnTo, { error: "tenant_name_required" }));

  try {
    const res = await createTenantService({ name, logoUrl });
    if (!res.ok) throw new Error(res.error);
    const tenantId = res?.tenant?.id ? String(res.tenant.id) : "";
    const url = new URL(returnTo, "http://localhost");
    if (tenantId) url.searchParams.set("tenantId", tenantId);
    url.searchParams.set("tenantCreated", "1");
    redirect(`${url.pathname}${url.search}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_tenant_failed") }));
  }
}

export async function updateTenant(formData: FormData) {
  await assertCsrfToken(formData);
  const tenantId = String(formData.get("tenantId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const logoUrl = String(formData.get("logoUrl") || "").trim();
  const factorRaw = String(formData.get("gamificationFactor") || "").trim();
  const bonusRaw = String(formData.get("gamificationBonus") || "").trim();
  const followupMinutesRaw = String(formData.get("followupMinutes") || "").trim();
  const followupCooldownRaw = String(formData.get("followupCooldownMinutes") || "").trim();
  const followupMaxAttemptsRaw = String(formData.get("followupMaxAttempts") || "").trim();
  const returnTo = String(formData.get("returnTo") || "").trim() || "/";
  if (!tenantId) return redirect(mergeQuery(returnTo, { error: "missing_tenant_id" }));
  if (!name) return redirect(mergeQuery(returnTo, { error: "tenant_name_required" }));

  const factor = factorRaw ? Number(factorRaw) : undefined;
  const bonus = bonusRaw ? Number(bonusRaw) : undefined;
  const followupMinutes = followupMinutesRaw ? Number(followupMinutesRaw) : undefined;
  const followupCooldownMinutes = followupCooldownRaw ? Number(followupCooldownRaw) : undefined;
  const followupMaxAttempts = followupMaxAttemptsRaw ? Number(followupMaxAttemptsRaw) : undefined;

  try {
    const updated = await updateTenantService({
      tenantId,
      name,
      logoUrl,
      gamification: {
        ...(Number.isFinite(factor as any) ? { factor } : {}),
        ...(Number.isFinite(bonus as any) ? { bonus } : {}),
        ...(Number.isFinite(followupMinutes as any) ? { followupMinutes } : {}),
        ...(Number.isFinite(followupCooldownMinutes as any) ? { followupCooldownMinutes } : {}),
        ...(Number.isFinite(followupMaxAttempts as any) ? { followupMaxAttempts } : {})
      }
    });
    if (!updated.ok) throw new Error(updated.error);
    redirect(mergeQuery(returnTo, { saved: "1" }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "update_tenant_failed") }));
  }
}

export async function deleteTenant(formData: FormData) {
  await assertCsrfToken(formData);
  const tenantId = String(formData.get("tenantId") || "").trim();
  const returnTo = String(formData.get("returnTo") || "").trim() || "/";
  if (!tenantId) return redirect(mergeQuery(returnTo, { error: "missing_tenant_id" }));

  try {
    const res = await deleteTenantService({ tenantId });
    if (!res.ok && res.status === 409 && res.error === "tenant_has_data") {
      const details = (res as any).details || {};
      return redirect(
        mergeQuery(returnTo, {
          tenantDeleteBlocked: "1",
          tenantCustomers: details.customers ? String(details.customers) : undefined,
          tenantPlans: details.plans ? String(details.plans) : undefined,
          tenantSubscriptions: details.subscriptions ? String(details.subscriptions) : undefined,
          tenantPayments: details.payments ? String(details.payments) : undefined,
          tenantPaymentLinks: details.paymentLinks ? String(details.paymentLinks) : undefined,
          tenantCheckoutTemplates: details.checkoutTemplates ? String(details.checkoutTemplates) : undefined
        })
      );
    }
    if (!res.ok) throw new Error(res.error);
    if ((res as any).archived) {
      return redirect(mergeQuery(returnTo, { deleted: "1", tenantArchived: "1" }));
    }
    redirect(mergeQuery(returnTo, { deleted: "1" }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "delete_tenant_failed") }));
  }
}
