export const SUPPORTED_CURRENCIES = [
  { code: "COP", label: "COP - Peso colombiano" },
  { code: "USD", label: "USD - Dolar estadounidense" },
  { code: "MXN", label: "MXN - Peso mexicano" },
  { code: "PEN", label: "PEN - Sol peruano" },
  { code: "CLP", label: "CLP - Peso chileno" }
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

export const DEFAULT_CURRENCY: SupportedCurrencyCode = "COP";

const SUPPORTED_CODES = new Set<SupportedCurrencyCode>(SUPPORTED_CURRENCIES.map((c) => c.code));

function isSupportedCurrencyCode(value: string): value is SupportedCurrencyCode {
  return SUPPORTED_CODES.has(value as SupportedCurrencyCode);
}

export function normalizeSupportedCurrency(input: string): SupportedCurrencyCode {
  const code = String(input || "").trim().toUpperCase();
  return isSupportedCurrencyCode(code) ? code : DEFAULT_CURRENCY;
}
