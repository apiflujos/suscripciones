"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import { createCustomer as createCustomerService, updateCustomerProfile, deleteCustomerProfile } from "../admin/_services/customers";
import type { CustomerMetadata } from "@suscripciones/core/lib/customerMetadata";

function safeReturnTo(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  if (raw.startsWith("/customers")) return raw;
  if (raw.startsWith("/billing")) return raw;
  if (raw.startsWith("/empresas")) return raw;
  if (raw.startsWith("/dashboard/empresas")) return raw;
  return "/customers";
}

function mergeQuery(path: string, extra: Record<string, string | undefined>) {
  const url = new URL(path, "http://localhost");
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    url.searchParams.set(k, v);
  }
  const qs = url.searchParams.toString();
  return `${url.pathname}${qs ? `?${qs}` : ""}`;
}

function buildCustomerMetadata(input: {
  addressLine1: string;
  dept: string;
  city: string;
  code5: string;
  dane8: string;
  idType: string;
  idNumber: string;
}): CustomerMetadata | undefined {
  const { addressLine1, dept, city, code5, dane8, idType, idNumber } = input;

  const address =
    addressLine1 || dept || city || code5 || dane8
      ? {
          line1: addressLine1 || undefined,
          dept: dept || undefined,
          city: city || undefined,
          code5: code5 || undefined,
          dane8: dane8 || undefined
        }
      : undefined;

  const identificacion = idType && idNumber ? `${idType} ${idNumber}` : idNumber || "";
  const idMeta: CustomerMetadata | undefined = identificacion
    ? {
        identificacion,
        ...(idNumber ? { identificacionNumero: idNumber } : {}),
        ...(idType ? { identificacionTipo: idType } : {})
      }
    : undefined;

  return address || idMeta ? { ...(address ? { address } : {}), ...(idMeta ? idMeta : {}) } : undefined;
}

export async function createCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const nameRaw = String(formData.get("name") || "").trim();
  const emailRaw = String(formData.get("email") || "").trim();
  const phoneRaw = String(formData.get("phone") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  const addressLine1 = String(formData.get("addressLine1") || "").trim();
  const dept = String(formData.get("dept") || "").trim();
  const city = String(formData.get("city") || "").trim();
  const code5 = String(formData.get("code5") || "").trim();
  const dane8 = String(formData.get("dane8") || "").trim();
  const idType = String(formData.get("idType") || "").trim();
  const idNumber = String(formData.get("idNumber") || "").trim();

  if (!phoneRaw) {
    return redirect(mergeQuery(returnTo, { error: "telefono_requerido", ...(tenantId ? { tenantId } : {}) }));
  }

  try {
    const metadata = buildCustomerMetadata({ addressLine1, dept, city, code5, dane8, idType, idNumber });

    const name = nameRaw || undefined;
    const email = emailRaw;
    const phone = phoneRaw;
    const res = await createCustomerService({
      data: {
        name,
        email,
        phone,
        metadata
      },
      tenantIds: tenantId ? [tenantId] : []
    });
    if (!res.ok) throw new Error(res.error);
    redirect(mergeQuery(returnTo, { created: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_customer_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export type UpdateCustomerActionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

export async function updateCustomer(formData: FormData): Promise<UpdateCustomerActionResult> {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const id = String(formData.get("id") || "").trim();
  const scopeTenantId = String(formData.get("scopeTenantId") || formData.get("tenantId") || "").trim();
  const tenantIds = formData
    .getAll("tenantIds")
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  const primaryTenantId = String(formData.get("primaryTenantId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const addressLine1 = String(formData.get("addressLine1") || "").trim();
  const dept = String(formData.get("dept") || "").trim();
  const city = String(formData.get("city") || "").trim();
  const code5 = String(formData.get("code5") || "").trim();
  const dane8 = String(formData.get("dane8") || "").trim();
  const idType = String(formData.get("idType") || "").trim();
  const idNumber = String(formData.get("idNumber") || "").trim();

  if (!id) return { ok: false, error: "invalid_id" as const };
  if (!phone) return { ok: false, error: "telefono_requerido" as const };

  try {
    const metadata = buildCustomerMetadata({ addressLine1, dept, city, code5, dane8, idType, idNumber });

    const updated = await updateCustomerProfile({
      customerId: id,
      tenantId: scopeTenantId || null,
      tenantIds,
      primaryTenantId: primaryTenantId || null,
      name: name || "",
      email: email || "",
      phone: phone || "",
      ...(metadata ? { metadata } : {})
    });
    if (!updated.ok) return { ok: false, error: updated.error };
    return {
      ok: true as const,
      redirectTo: mergeQuery(returnTo, { updated: "1", ...(scopeTenantId ? { tenantId: scopeTenantId } : {}) })
    };
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    return { ok: false, error: String(err?.message || "update_customer_failed") };
  }
}

export async function deleteCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const id = String(formData.get("id") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!id) return redirect(mergeQuery(returnTo, { error: "invalid_id" }));
  try {
    const res = await deleteCustomerProfile({ customerId: id, tenantId: tenantId || null, force: true });
    if (!res.ok) throw new Error(res.error);
    redirect(mergeQuery(returnTo, { deleted: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "delete_customer_failed");
    if (msg.includes("customer_has_dependencies")) {
      return redirect(mergeQuery(returnTo, { error: "No se pudo borrar el contacto.", ...(tenantId ? { tenantId } : {}) }));
    }
    redirect(mergeQuery(returnTo, { error: msg, ...(tenantId ? { tenantId } : {}) }));
  }
}
