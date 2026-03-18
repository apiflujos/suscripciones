import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { createCustomer, createCustomerSchema } from "../../../admin/_services/customers";
import { createCatalogProduct } from "../../../admin/_services/products";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        value += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(value.trim());
      value = "";
      continue;
    }
    if (c === "\n") {
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    if (c === "\r") continue;
    value += c;
  }
  if (value.length || row.length) {
    row.push(value.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v || "").trim().length > 0));
}

function toNumber(value: string, fallback = 0) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value: string, fallback = false) {
  const v = String(value || "").trim().toLowerCase();
  if (["1", "true", "si", "sí", "yes"].includes(v)) return true;
  if (["0", "false", "no"].includes(v)) return false;
  return fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireApiSession(req);
    if (!auth.ok) return auth.response;

    const formData = await req.formData();
    const entity = String(formData.get("entity") || "").trim().toLowerCase();
    const tenantId = String(formData.get("tenantId") || "").trim();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });

    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) return NextResponse.json({ ok: false, error: "empty_csv" }, { status: 400 });

    const headers = rows[0].map((h) => String(h || "").trim());
    const dataRows = rows.slice(1);
    if (!dataRows.length) return NextResponse.json({ ok: false, error: "csv_without_rows" }, { status: 400 });
    const idx = new Map(headers.map((h, i) => [h, i]));

    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < dataRows.length; i += 1) {
      const line = dataRows[i];
      const lineNo = i + 2;
      try {
        if (entity === "customers") {
          const name = String(line[idx.get("name") ?? -1] || "").trim();
          const email = String(line[idx.get("email") ?? -1] || "").trim();
          const phone = String(line[idx.get("phone") ?? -1] || "").trim();
          const idType = String(line[idx.get("idType") ?? -1] || "").trim();
          const idNumber = String(line[idx.get("idNumber") ?? -1] || "").trim();
          const addressLine1 = String(line[idx.get("addressLine1") ?? -1] || "").trim();
          const dept = String(line[idx.get("dept") ?? -1] || "").trim();
          const city = String(line[idx.get("city") ?? -1] || "").trim();
          const code5 = String(line[idx.get("code5") ?? -1] || "").trim();
          const dane8 = String(line[idx.get("dane8") ?? -1] || "").trim();

          if (!email || !phone) throw new Error("email_y_telefono_requeridos");

          const metadata: any = {};
          if (idType || idNumber) {
            const identificacion = [idType, idNumber].filter(Boolean).join(" ");
            metadata.identificacion = identificacion || undefined;
            metadata.identificacionTipo = idType || undefined;
            metadata.identificacionNumero = idNumber || undefined;
          }
          if (addressLine1 || dept || city || code5 || dane8) {
            metadata.address = {
              ...(addressLine1 ? { line1: addressLine1 } : {}),
              ...(dept ? { dept } : {}),
              ...(city ? { city } : {}),
              ...(code5 ? { code5 } : {}),
              ...(dane8 ? { dane8 } : {})
            };
          }

          const parsed = createCustomerSchema.safeParse({
            ...(name ? { name } : {}),
            email,
            phone,
            ...(Object.keys(metadata).length ? { metadata } : {})
          });
          if (!parsed.success) throw new Error("cuerpo_invalido");

          const tenantIds = [tenantId || auth.session.tenantId || ""].filter(Boolean);
          const res = await createCustomer({ data: parsed.data, tenantIds });
          if (!res.ok) throw new Error(res.error || "create_failed");
        } else if (entity === "products") {
          const name = String(line[idx.get("name") ?? -1] || "").trim();
          const sku = String(line[idx.get("sku") ?? -1] || "").trim();
          const kindRaw = String(line[idx.get("kind") ?? -1] || "PRODUCT").trim().toUpperCase();
          const kind = kindRaw === "SERVICE" ? "SERVICE" : "PRODUCT";
          const priceCop = toNumber(String(line[idx.get("price_cop") ?? -1] || "0"), 0);
          const currency = String(line[idx.get("currency") ?? -1] || "COP").trim().toUpperCase() || "COP";
          const requiresShipping = toBool(String(line[idx.get("requiresShipping") ?? -1] || ""), false);
          const taxPercent = Math.max(0, Math.min(100, Math.trunc(toNumber(String(line[idx.get("taxPercent") ?? -1] || "0"), 0))));
          const discountTypeRaw = String(line[idx.get("discountType") ?? -1] || "NONE").trim().toUpperCase();
          const discountType = ["NONE", "FIXED", "PERCENT"].includes(discountTypeRaw) ? discountTypeRaw : "NONE";
          const discountValue = Math.max(0, Math.trunc(toNumber(String(line[idx.get("discountValue") ?? -1] || "0"), 0)));
          const discountPercent = Math.max(0, Math.min(100, Math.trunc(toNumber(String(line[idx.get("discountPercent") ?? -1] || "0"), 0))));
          const description = String(line[idx.get("description") ?? -1] || "").trim();

          if (!name || !sku || priceCop <= 0) throw new Error("name_sku_price_requeridos");

          const tenantIds = [tenantId || auth.session.tenantId || ""].filter(Boolean);
          const res = await createCatalogProduct({
            tenantIds,
            name,
            sku,
            kind: kind as any,
            currency,
            basePriceInCents: Math.trunc(priceCop) * 100,
            taxPercent,
            discountType,
            discountValueInCents: discountValue * 100,
            discountPercent,
            requiresShipping,
            description: description || null
          });
          if (!res.ok) throw new Error(res.error || "create_failed");
        } else {
          throw new Error("entity_invalida");
        }
        imported += 1;
      } catch (err: any) {
        failed += 1;
        errors.push(`Línea ${lineNo}: ${String(err?.message || "error_importando")}`);
      }
    }

    return NextResponse.json({ ok: true, imported, failed, errors });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || "csv_import_failed") }, { status: 500 });
  }
}
