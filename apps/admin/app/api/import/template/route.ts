import { NextResponse } from "next/server";

function buildCustomersTemplate() {
  const headers = ["name", "email", "phone", "idType", "idNumber", "addressLine1", "dept", "city", "code5", "dane8"];
  const sample = ["Cliente Demo", "cliente@example.com", "3001234567", "CC", "123456789", "Calle 10 # 20-30", "11", "11001", "11001", "11001000"];
  return `${headers.join(",")}\n${sample.join(",")}\n`;
}

function buildProductsTemplate() {
  const headers = [
    "name",
    "sku",
    "kind",
    "price_cop",
    "currency",
    "requiresShipping",
    "taxPercent",
    "discountType",
    "discountValue",
    "discountPercent",
    "description"
  ];
  const sample = ["Producto Demo", "SKU-DEMO-001", "PRODUCT", "120000", "COP", "true", "0", "NONE", "0", "0", "Descripción opcional"];
  return `${headers.join(",")}\n${sample.join(",")}\n`;
}

function buildCompaniesTemplate() {
  const headers = ["name", "email", "phone", "address", "website"];
  const sample = ["Empresa Demo", "contacto@empresa.com", "3001234567", "Calle 1 # 2-3", "https://empresa.com"];
  return `${headers.join(",")}\n${sample.join(",")}\n`;
}

function buildPaymentsTemplate() {
  const headers = ["reference", "wompiTransactionId", "customerEmail", "amount_cop", "currency", "status", "paidAt"];
  const sample = ["REF-001", "WOMPI_TX_123", "cliente@example.com", "120000", "COP", "APPROVED", "2026-03-27T10:30:00Z"];
  return `${headers.join(",")}\n${sample.join(",")}\n`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entity = String(searchParams.get("entity") || "").trim().toLowerCase();
  const isProducts = entity === "products";
  const isCompanies = entity === "companies";
  const isPayments = entity === "payments";
  const body = isPayments
    ? buildPaymentsTemplate()
    : isCompanies
      ? buildCompaniesTemplate()
      : isProducts
        ? buildProductsTemplate()
        : buildCustomersTemplate();
  const filename = isPayments
    ? "plantilla_pagos.csv"
    : isCompanies
      ? "plantilla_empresas.csv"
      : isProducts
        ? "plantilla_productos.csv"
        : "plantilla_contactos.csv";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
}
