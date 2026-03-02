export const SUPPORTED_CURRENCIES = ["COP", "USD", "MXN", "PEN", "CLP"] as const;
export const DEFAULT_CURRENCY = "COP";

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function normalizeCurrencyCode(input: unknown): string {
  return String(input ?? DEFAULT_CURRENCY).trim().toUpperCase();
}

export function isSupportedCurrency(input: string): input is SupportedCurrency {
  return SUPPORTED_CURRENCIES.includes(input as SupportedCurrency);
}
