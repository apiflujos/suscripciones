"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CURRENCY = exports.SUPPORTED_CURRENCIES = void 0;
exports.normalizeCurrencyCode = normalizeCurrencyCode;
exports.isSupportedCurrency = isSupportedCurrency;
exports.SUPPORTED_CURRENCIES = ["COP", "USD", "MXN", "PEN", "CLP"];
exports.DEFAULT_CURRENCY = "COP";
function normalizeCurrencyCode(input) {
    return String(input ?? exports.DEFAULT_CURRENCY).trim().toUpperCase();
}
function isSupportedCurrency(input) {
    return exports.SUPPORTED_CURRENCIES.includes(input);
}
