import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, normalizeSaToken } from "../superAdminAuth";

test("hashPassword + verifyPassword roundtrip", () => {
  const stored = hashPassword("secret");
  assert.ok(stored.startsWith("pbkdf2_sha256$"));
  assert.equal(verifyPassword("secret", stored), true);
  assert.equal(verifyPassword("wrong", stored), false);
});

test("verifyPassword: invalid formats are rejected", () => {
  assert.equal(verifyPassword("secret", ""), false);
  assert.equal(verifyPassword("secret", "pbkdf2_sha256$1$abc$def"), false);
  assert.equal(verifyPassword("secret", "md5$1$abc$def"), false);
});

test("normalizeSaToken strips Bearer", () => {
  assert.equal(normalizeSaToken("Bearer abc"), "abc");
  assert.equal(normalizeSaToken("abc"), "abc");
  assert.equal(normalizeSaToken(""), "");
});
