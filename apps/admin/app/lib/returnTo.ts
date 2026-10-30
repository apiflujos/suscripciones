/**
 * Adónde volver tras guardar o cancelar una página dedicada.
 *
 * Las acciones de servidor ya reciben `returnTo` y redirigen ahí con el resultado
 * (`?chargeStatus=ok`, `?error=…`). Las páginas nuevas lo reciben en la URL y lo
 * reenvían en un campo oculto, así la lista conserva filtros y página.
 *
 * Solo se aceptan rutas internas: nada de `//otro-sitio` ni de `https://…`.
 */
export function resolveReturnTo(raw: unknown, fallback: string): string {
  const value = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) return fallback;
  return trimmed;
}

/** `/ruta/destino?returnTo=…` — arma el enlace a una página dedicada conservando el retorno. */
export function withReturnTo(href: string, returnTo: string): string {
  if (!returnTo) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}returnTo=${encodeURIComponent(returnTo)}`;
}
