import { NextResponse } from "next/server";
import { getAdminApiConfig } from "../../lib/adminApi";

function escapeCsv(value: unknown) {
  const raw = String(value ?? "");
  if (!raw.includes(",") && !raw.includes('"') && !raw.includes("\n") && !raw.includes("\r")) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const header = headers.join(",");
  const body = rows
    .map((row) => headers.map((h) => escapeCsv(row[h])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

async function adminFetch(path: string) {
  const { apiBase, token } = getAdminApiConfig();
  const res = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: { ...(token ? { authorization: `Bearer ${token}`, "x-admin-token": token } : {}) }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json?.error || `request_failed_${res.status}`));
  return json;
}

async function fetchAll(pathBase: string, take = 500, cap = 5000) {
  const out: any[] = [];
  let skip = 0;
  while (out.length < cap) {
    const join = pathBase.includes("?") ? "&" : "?";
    const json = await adminFetch(`${pathBase}${join}take=${take}&skip=${skip}`);
    const items = Array.isArray(json?.items) ? json.items : [];
    out.push(...items);
    if (items.length < take) break;
    skip += take;
  }
  return out.slice(0, cap);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "").trim().toLowerCase();
    const q = String(searchParams.get("q") || "").trim();
    const tenantId = String(searchParams.get("tenantId") || "").trim();
    const tipo = String(searchParams.get("tipo") || "").trim();
    const estado = String(searchParams.get("estado") || "").trim();
    const ordenar = String(searchParams.get("ordenar") || "").trim();

    if (scope === "customers") {
      const qs = new URLSearchParams();
      if (q) qs.set("q", q);
      if (tenantId) qs.set("tenantId", tenantId);
      const items = await fetchAll(`/admin/customers${qs.size ? `?${qs.toString()}` : ""}`);
      const csv = toCsv(
        ["id", "name", "email", "phone", "identificacion", "tenantId", "createdAt"],
        items.map((c: any) => ({
          id: c?.id,
          name: c?.name,
          email: c?.email,
          phone: c?.phone,
          identificacion: c?.metadata?.identificacion || c?.metadata?.documentNumber || "",
          tenantId: c?.tenantId || "",
          createdAt: c?.createdAt || ""
        }))
      );
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="contactos.csv"`
        }
      });
    }

    if (scope === "products") {
      const qs = new URLSearchParams();
      if (q) qs.set("q", q);
      if (tenantId) qs.set("tenantId", tenantId);
      const items = await fetchAll(`/admin/products${qs.size ? `?${qs.toString()}` : ""}`);
      const csv = toCsv(
        ["id", "name", "sku", "kind", "price_cop", "currency", "requiresShipping", "taxPercent", "discountType", "createdAt"],
        items.map((p: any) => ({
          id: p?.id,
          name: p?.name,
          sku: p?.sku,
          kind: p?.kind,
          price_cop: Math.trunc(Number(p?.basePriceInCents || 0) / 100),
          currency: p?.currency || "COP",
          requiresShipping: p?.requiresShipping ? "true" : "false",
          taxPercent: p?.taxPercent || 0,
          discountType: p?.discountType || "NONE",
          createdAt: p?.createdAt || ""
        }))
      );
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="productos.csv"`
        }
      });
    }

    if (scope === "billing") {
      const qs = new URLSearchParams();
      if (q) qs.set("q", q);
      if (tenantId) qs.set("tenantId", tenantId);
      if (estado && estado !== "todos") qs.set("estado", estado);
      if (tipo === "suscripciones") qs.set("collectionMode", "AUTO_DEBIT");
      if (tipo === "planes") qs.set("collectionMode", "MANUAL_LINK");
      if (ordenar) qs.set("ordenar", ordenar);
      const items = await fetchAll(`/admin/subscriptions${qs.size ? `?${qs.toString()}` : ""}`, 300, 3000);
      const csv = toCsv(
        ["id", "customerId", "customerName", "planId", "planName", "status", "collectionMode", "amount_cop", "currency", "periodEndAt"],
        items.map((s: any) => ({
          id: s?.id,
          customerId: s?.customerId || s?.customer?.id || "",
          customerName: s?.customer?.name || s?.customer?.email || "",
          planId: s?.planId || s?.plan?.id || "",
          planName: s?.plan?.name || "",
          status: s?.status || "",
          collectionMode: s?.plan?.collectionMode || s?.plan?.metadata?.collectionMode || "",
          amount_cop: Math.trunc(Number(s?.plan?.priceInCents || 0) / 100),
          currency: s?.plan?.currency || "COP",
          periodEndAt: s?.currentPeriodEndAt || ""
        }))
      );
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="suscripciones.csv"`
        }
      });
    }

    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || "csv_export_failed") }, { status: 500 });
  }
}
