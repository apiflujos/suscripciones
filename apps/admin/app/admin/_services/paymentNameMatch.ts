const STOP_WORDS = new Set(["del", "las", "los", "sas", "ltda"]);

/** Palabras del nombre sin acentos ni mayúsculas, sin conectores ("de", "la", "y"). */
export function nameTokens(value: unknown): string[] {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/** Cuántas palabras comparten dos nombres. */
export function sharedNameTokens(a: unknown, b: unknown): number {
  const other = new Set(nameTokens(b));
  return Array.from(new Set(nameTokens(a))).filter((t) => other.has(t)).length;
}

/**
 * ¿Parecen la misma persona? Dos palabras en común: "Lina Cruz" y "Lina Marcela
 * Cruz", o "Elsa Echavarria Saldarriaga" y "Maria Elsa Echavarría". Con una sola
 * ("Juan Gonzalez" y "Juan Lozano") no alcanza.
 */
export function namesLookRelated(a: unknown, b: unknown): boolean {
  return sharedNameTokens(a, b) >= 2;
}

const digitsOf = (value: unknown) => String(value ?? "").replace(/\D+/g, "");

/** Mismo teléfono: se comparan los últimos 10 dígitos, sin el indicativo. */
export function samePhone(a: unknown, b: unknown): boolean {
  const da = digitsOf(a).slice(-10);
  const db = digitsOf(b).slice(-10);
  return da.length >= 7 && da === db;
}

/** Búsqueda libre sin acentos: todas las palabras escritas deben aparecer. */
export function matchesQuery(haystack: unknown, query: string): boolean {
  const words = nameTokens(query);
  const digits = digitsOf(query);
  if (digits.length >= 4 && digitsOf(haystack).includes(digits)) return true;
  if (!words.length) return false;
  const text = String(haystack ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return words.every((w) => text.includes(w));
}
