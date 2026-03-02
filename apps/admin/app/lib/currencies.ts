export const SUPPORTED_CURRENCIES = [
  { code: "COP", label: "COP - Peso colombiano" },
  { code: "USD", label: "USD - Dolar estadounidense" },
  { code: "MXN", label: "MXN - Peso mexicano" },
  { code: "PEN", label: "PEN - Sol peruano" },
  { code: "CLP", label: "CLP - Peso chileno" }
] as const;

export const DEFAULT_CURRENCY = "COP";

const SUPPORTED_CODES = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));

export function normalizeSupportedCurrency(input: string): string {
  const code = String(input || "").trim().toUpperCase();
  return SUPPORTED_CODES.has(code) ? code : DEFAULT_CURRENCY;
}
