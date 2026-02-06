"use server";

import { redirect } from "next/navigation";
import { saAdminFetch } from "../../saApi";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

export async function createPlan(formData: FormData) {
  const key = String(formData.get("key") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const kind = String(formData.get("kind") || "").trim();
  const monthlyPriceInCents = Number(formData.get("monthlyPriceInCents") || 0);

  try {
    const res = await saAdminFetch("/admin/sa/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, name, kind, monthlyPriceInCents })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect("/sa/plans?created=1");
  } catch (err) {
    redirect(`/sa/plans?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function setPlanServiceLimit(formData: FormData) {
  const planId = String(formData.get("planId") || "").trim();
  const serviceKey = String(formData.get("serviceKey") || "").trim();

  const isUnlimited = String(formData.get("isUnlimited") || "").trim() === "1";
  const maxValueRaw = String(formData.get("maxValue") || "").trim();
  const unitPriceInCentsRaw = String(formData.get("unitPriceInCents") || "").trim();

  const maxValue = maxValueRaw === "" ? null : Number(maxValueRaw);
  const unitPriceInCents = unitPriceInCentsRaw === "" ? undefined : Number(unitPriceInCentsRaw);

  try {
    const res = await saAdminFetch(`/admin/sa/plans/${encodeURIComponent(planId)}/services/${encodeURIComponent(serviceKey)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isUnlimited, maxValue, unitPriceInCents })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect("/sa/plans?saved=1");
  } catch (err) {
    redirect(`/sa/plans?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
