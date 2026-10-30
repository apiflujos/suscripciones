import { normalizeErrorParam } from "../lib/errorParam";

export function formatMoneyFromCents(cents: number, currency: string) {
  const pesos = Math.trunc(Number(cents || 0) / 100);
  if (!Number.isFinite(pesos)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(pesos);
}

export function formatCurrencyInput(input: string, currency: string): string {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

const PRODUCT_ERRORS: Record<string, string> = {
  invalid_body: "Revisa los datos: nombre, SKU y un precio mayor a 0 son obligatorios.",
  missing_id: "No se encontró el producto.",
  missing_product_or_customer: "Selecciona un contacto para enviar el producto.",
  product_or_customer_not_found: "No se encontró el producto o el contacto.",
  create_product_failed: "No se pudo crear el producto.",
  update_product_failed: "No se pudo guardar el producto.",
  delete_product_failed: "No se pudo eliminar el producto.",
  not_found: "No se encontró el producto."
};

/** Mensaje en español para el parámetro `error` de las páginas de productos. */
export function productErrorMessage(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  return PRODUCT_ERRORS[value] || normalizeErrorParam(value);
}
