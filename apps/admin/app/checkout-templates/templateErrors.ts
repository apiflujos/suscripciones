/** Textos en español para los códigos de error de las acciones de plantillas de checkout. */
export function checkoutTemplateErrorMessage(code: string): string {
  const errorText = String(code || "");
  if (errorText.startsWith("cart_mixed_collection")) {
    return "El catálogo no puede mezclar planes y suscripciones. Elige solo un tipo.";
  }
  if (errorText.startsWith("invalid_body")) return "Faltan datos obligatorios. Completa los campos requeridos.";
  if (errorText.startsWith("tenant_required")) return "Debes seleccionar un canal de ventas para la plantilla.";
  if (errorText.startsWith("product_required")) return "Debes asociar al menos un producto a la plantilla.";
  if (errorText.startsWith("max_one_product")) {
    return "Link de pago y débito automático solo pueden tener un producto asociado.";
  }
  if (errorText.startsWith("not_found")) return "La plantilla ya no existe.";
  return `Error: ${errorText || "unknown_error"}`;
}

export type TemplateKind = "PLAN" | "SUBSCRIPTION" | "CART";

export function checkoutTemplateKindLabel(kind: string): string {
  return kind === "PLAN" ? "Link de pago" : kind === "CART" ? "Catálogo" : "Débito automático";
}

/** Lo que las páginas de lista y de formulario necesitan saber de un producto. */
export type TemplateProduct = { id: string; name: string; sku?: string; metadata?: any; collectionMode?: string };
export type TemplateTenant = { id: string; name: string };
