import { sha256Hex } from "./crypto";
import { SUPPORTED_CURRENCIES } from "./currencies";

export const WOMPI_SUPPORTED_CURRENCIES = SUPPORTED_CURRENCIES;

const zeroWidthChars = /[\u200B-\u200D\uFEFF]/g;

function normalizeReference(reference: string): string {
  return String(reference || "").replace(zeroWidthChars, "").trim();
}

function normalizeCurrency(currency: string): string {
  return String(currency || "").replace(zeroWidthChars, "").trim().toUpperCase();
}

function normalizeIntegritySecret(integritySecret: string): string {
  return String(integritySecret || "").replace(zeroWidthChars, "").trim();
}

function normalizeAmountInCents(amountInCents: number): number {
  return Math.trunc(Number(amountInCents || 0));
}

export function validateWompiCurrency(currency: string): string {
  const normalized = normalizeCurrency(currency);
  if (!WOMPI_SUPPORTED_CURRENCIES.includes(normalized as (typeof WOMPI_SUPPORTED_CURRENCIES)[number])) {
    throw new Error("unsupported_wompi_currency");
  }
  return normalized;
}

export function buildWompiTransactionSignature(args: {
  reference: string;
  amountInCents: number;
  currency: string;
  integritySecret: string;
}): { signature: string; normalizedReference: string; normalizedAmountInCents: number; normalizedCurrency: string } {
  const normalizedReference = normalizeReference(args.reference);
  const normalizedAmountInCents = normalizeAmountInCents(args.amountInCents);
  const normalizedCurrency = validateWompiCurrency(args.currency);
  const normalizedIntegritySecret = normalizeIntegritySecret(args.integritySecret);

  if (!normalizedReference) throw new Error("invalid_wompi_reference");
  if (!Number.isFinite(normalizedAmountInCents) || normalizedAmountInCents <= 0) {
    throw new Error("invalid_wompi_amount_in_cents");
  }
  if (!normalizedIntegritySecret) throw new Error("invalid_wompi_integrity_secret");

  const signature = sha256Hex(
    `${normalizedReference}${normalizedAmountInCents}${normalizedCurrency}${normalizedIntegritySecret}`
  );

  return { signature, normalizedReference, normalizedAmountInCents, normalizedCurrency };
}
