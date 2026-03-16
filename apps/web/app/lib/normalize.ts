/**
 * Utilidades para normalizar respuestas y valores en el frontend
 * Elimina la necesidad de fallbacks repetidos en todo el código
 */

/**
 * Normaliza una respuesta de API, garantizando estructura consistente
 */
export function normalizeApiResponse<T>(response: { ok: boolean; json?: any; status?: number }, defaultValue: T): T {
  if (!response?.ok || !response?.json) return defaultValue;
  return response.json as T ?? defaultValue;
}

/**
 * Normaliza un array de respuesta, garantizando que siempre sea un array
 */
export function normalizeArray<T>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  return [];
}

/**
 * Normaliza un objeto de respuesta, garantizando que siempre sea un objeto
 */
export function normalizeObject<T extends Record<string, unknown>>(value: unknown): T {
  if (!value || typeof value !== "object") return {} as T;
  return value as T;
}

/**
 * Normaliza un string, eliminando espacios y garantizando valor seguro
 */
export function normalizeString(value: unknown, defaultValue = ""): string {
  if (typeof value !== "string") return defaultValue;
  return value.trim() || defaultValue;
}

/**
 * Normaliza un número, garantizando valor finito
 */
export function normalizeNumber(value: unknown, defaultValue = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

/**
 * Normaliza un booleano desde string o valor desconocido
 */
export function normalizeBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  return defaultValue;
}

/**
 * Extrae items de una respuesta de API con paginación
 */
export function extractItems<T>(response: { ok: boolean; json?: any }, defaultValue: T[] = []): T[] {
  if (!response?.ok || !response?.json) return defaultValue;
  const items = response.json?.items;
  if (!Array.isArray(items)) return defaultValue;
  return items as T[];
}

/**
 * Extrae el total de una respuesta paginada
 */
export function extractTotal(response: { ok: boolean; json?: any }, fallback: number | null = null): number | null {
  if (!response?.ok || !response?.json) return fallback;
  const total = response.json?.total;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  return fallback;
}

/**
 * Crea un mapa desde una respuesta de API
 */
export function createMapFromResponse<T extends { id?: string | number }>(
  items: T[],
  keyFn: (item: T) => string | number = (item) => String(item.id ?? "")
): Map<string | number, T> {
  return new Map(items.map((item) => [keyFn(item), item]));
}

/**
 * Filtra items falsy de un array
 */
export function filterFalsy<T>(value: T | null | undefined | false | 0 | ""): value is T {
  return Boolean(value);
}

/**
 * Obtiene un valor seguro de un objeto anidado
 */
export function safeGet<T extends Record<string, any>, K extends keyof T>(obj: T | null | undefined, key: K): T[K] | undefined {
  if (!obj) return undefined;
  return obj[key];
}

/**
 * Obtiene un valor profundo seguro de un objeto anidado
 */
export function safeDeepGet<T>(obj: Record<string, any> | null | undefined, path: string, defaultValue: T): T {
  if (!obj) return defaultValue;
  
  const keys = path.split(".");
  let current: any = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined) return defaultValue;
    current = current[key];
  }
  
  return current ?? defaultValue;
}
