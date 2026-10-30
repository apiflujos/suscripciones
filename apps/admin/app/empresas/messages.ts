import { normalizeErrorParam } from "../lib/errorParam";

const EMPRESA_ERRORS: Record<string, string> = {
  nombre_requerido: "El nombre de la empresa es obligatorio.",
  email_invalido: "El email de la empresa no es válido.",
  contacto_sin_nombre: "Todos los contactos necesitan nombre.",
  contacto_sin_cargo: "Todos los contactos necesitan cargo.",
  contacto_email_invalido: "Un contacto tiene un email no válido.",
  empresa_no_encontrada: "No se encontró la empresa."
};

/** Mensaje en español para el `?error=` que dejan las acciones de empresas. */
export function empresaErrorMessage(raw: unknown): string {
  const value = String(Array.isArray(raw) ? raw[0] : raw || "").trim();
  if (!value) return "";
  return EMPRESA_ERRORS[value] || normalizeErrorParam(value);
}
