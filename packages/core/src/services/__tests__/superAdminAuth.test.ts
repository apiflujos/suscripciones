import { test, expect } from "vitest";
import { hashPassword, verifyPassword, normalizeSaToken } from "../superAdminAuth";

test("hashPassword + verifyPassword roundtrip", () => {
  const stored = hashPassword("secret");
  expect(stored.startsWith("pbkdf2_sha256$")).toBe(true);
  expect(verifyPassword("secret", stored)).toBe(true);
  expect(verifyPassword("wrong", stored)).toBe(false);
});

test("verifyPassword: invalid formats are rejected", () => {
  expect(verifyPassword("secret", "")).toBe(false);
  expect(verifyPassword("secret", "pbkdf2_sha256$1$abc$def")).toBe(false);
  expect(verifyPassword("secret", "md5$1$abc$def")).toBe(false);
});

test("normalizeSaToken strips Bearer", () => {
  expect(normalizeSaToken("Bearer abc")).toBe("abc");
  expect(normalizeSaToken("abc")).toBe("abc");
  expect(normalizeSaToken("")).toBe("");
});
