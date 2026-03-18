import test from "node:test";
import assert from "node:assert/strict";
import { buildWompiTransactionSignature, validateWompiCurrency } from "../wompiSignature";
import { sha256Hex } from "../crypto";

test("validateWompiCurrency normalizes to uppercase", () => {
  const currency = validateWompiCurrency(" cop ");
  assert.equal(currency, "COP");
});

test("buildWompiTransactionSignature normalizes inputs before signing", () => {
  const result = buildWompiTransactionSignature({
    reference: " REF-123 \u200B",
    amountInCents: 25000000.99,
    currency: "cop",
    integritySecret: " sk_test_abc123 "
  });

  assert.equal(result.normalizedReference, "REF-123");
  assert.equal(result.normalizedAmountInCents, 25000000);
  assert.equal(result.normalizedCurrency, "COP");
  assert.equal(result.signature, sha256Hex("REF-12325000000COPsk_test_abc123"));
});

test("buildWompiTransactionSignature rejects unsupported currency", () => {
  assert.throws(
    () =>
      buildWompiTransactionSignature({
        reference: "REF-1",
        amountInCents: 1000,
        currency: "EUR",
        integritySecret: "sk_test_abc123"
      }),
    /unsupported_wompi_currency/
  );
});
