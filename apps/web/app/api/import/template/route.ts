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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entity = String(searchParams.get("entity") || "").trim().toLowerCase();
  const isProducts = entity === "products";
  const body = isProducts ? buildProductsTemplate() : buildCustomersTemplate();
  const filename = isProducts ? "plantilla_productos.csv" : "plantilla_contactos.csv";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
}
