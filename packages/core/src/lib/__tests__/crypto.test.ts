import { test, expect } from "vitest";
import crypto from "node:crypto";
import { sha256Hex, timingSafeEqualHex, encryptAes256Gcm, decryptAes256Gcm } from "../crypto";

test("sha256Hex: deterministic", () => {
  const a = sha256Hex("hello");
  const b = sha256Hex("hello");
  expect(a).toBe(b);
});

test("timingSafeEqualHex: compares hex strings", () => {
  const a = sha256Hex("a");
  const b = sha256Hex("a");
  const c = sha256Hex("b");
  expect(timingSafeEqualHex(a, b)).toBe(true);
  expect(timingSafeEqualHex(a, c)).toBe(false);
});

test("encrypt/decrypt aes-256-gcm roundtrip", () => {
  const key = crypto.randomBytes(32);
  const plaintext = "secret message";
  const enc = encryptAes256Gcm(plaintext, key);
  const dec = decryptAes256Gcm(enc, key);
  expect(dec).toBe(plaintext);
});
