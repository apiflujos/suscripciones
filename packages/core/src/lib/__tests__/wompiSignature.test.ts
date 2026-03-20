import { test, expect } from "vitest";
import { buildWompiTransactionSignature, validateWompiCurrency } from "../wompiSignature";
import { sha256Hex } from "../crypto";

test("validateWompiCurrency normalizes to uppercase", () => {
  const currency = validateWompiCurrency(" cop ");
  expect(currency).toBe("COP");
});

test("buildWompiTransactionSignature normalizes inputs before signing", () => {
  const result = buildWompiTransactionSignature({
    reference: " REF-123 \u200B",
    amountInCents: 25000000.99,
    currency: "cop",
    integritySecret: " sk_test_abc123 "
  });

  expect(result.normalizedReference).toBe("REF-123");
  expect(result.normalizedAmountInCents).toBe(25000000);
  expect(result.normalizedCurrency).toBe("COP");
  expect(result.signature).toBe(sha256Hex("REF-12325000000COPsk_test_abc123"));
});

test("buildWompiTransactionSignature rejects unsupported currency", () => {
  expect(() =>
    buildWompiTransactionSignature({
      reference: "REF-1",
      amountInCents: 1000,
      currency: "EUR",
      integritySecret: "sk_test_abc123"
    })
  ).toThrow(/unsupported_wompi_currency/);
});
