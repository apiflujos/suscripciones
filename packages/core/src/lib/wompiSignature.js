"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WOMPI_SUPPORTED_CURRENCIES = void 0;
exports.validateWompiCurrency = validateWompiCurrency;
exports.buildWompiTransactionSignature = buildWompiTransactionSignature;
const crypto_1 = require("./crypto");
const currencies_1 = require("./currencies");
exports.WOMPI_SUPPORTED_CURRENCIES = currencies_1.SUPPORTED_CURRENCIES;
const zeroWidthChars = /[\u200B-\u200D\uFEFF]/g;
function normalizeReference(reference) {
    return String(reference || "").replace(zeroWidthChars, "").trim();
}
function normalizeCurrency(currency) {
    return String(currency || "").replace(zeroWidthChars, "").trim().toUpperCase();
}
function normalizeIntegritySecret(integritySecret) {
    return String(integritySecret || "").replace(zeroWidthChars, "").trim();
}
function normalizeAmountInCents(amountInCents) {
    return Math.trunc(Number(amountInCents || 0));
}
function validateWompiCurrency(currency) {
    const normalized = normalizeCurrency(currency);
    if (!exports.WOMPI_SUPPORTED_CURRENCIES.includes(normalized)) {
        throw new Error("unsupported_wompi_currency");
    }
    return normalized;
}
function buildWompiTransactionSignature(args) {
    const normalizedReference = normalizeReference(args.reference);
    const normalizedAmountInCents = normalizeAmountInCents(args.amountInCents);
    const normalizedCurrency = validateWompiCurrency(args.currency);
    const normalizedIntegritySecret = normalizeIntegritySecret(args.integritySecret);
    if (!normalizedReference)
        throw new Error("invalid_wompi_reference");
    if (!Number.isFinite(normalizedAmountInCents) || normalizedAmountInCents <= 0) {
        throw new Error("invalid_wompi_amount_in_cents");
    }
    if (!normalizedIntegritySecret)
        throw new Error("invalid_wompi_integrity_secret");
    const signature = (0, crypto_1.sha256Hex)(`${normalizedReference}${normalizedAmountInCents}${normalizedCurrency}${normalizedIntegritySecret}`);
    return { signature, normalizedReference, normalizedAmountInCents, normalizedCurrency };
}
