import { normalizeErrorParam } from "../lib/errorParam";

/** Mensaje en español para el `?error=` de las páginas de contactos. */
export function customerErrorText(raw: unknown) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "contacto_requerido") return "Ingresa al menos un teléfono o un email.";
  if (value === "telefono_invalido") return "El teléfono no es válido. Incluye el indicativo, por ejemplo +57 300 123 4567.";
  if (value === "invalid_id") return "No se encontró el contacto.";
  return normalizeErrorParam(value);
}
