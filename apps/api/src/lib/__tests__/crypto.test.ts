import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sha256Hex, timingSafeEqualHex, encryptAes256Gcm, decryptAes256Gcm } from "../crypto.ts";

test("sha256Hex: deterministic", () => {
  const a = sha256Hex("hello");
  const b = sha256Hex("hello");
  assert.equal(a, b);
});

test("timingSafeEqualHex: compares hex strings", () => {
  const a = sha256Hex("a");
  const b = sha256Hex("a");
  const c = sha256Hex("b");
  assert.equal(timingSafeEqualHex(a, b), true);
  assert.equal(timingSafeEqualHex(a, c), false);
});

test("encrypt/decrypt aes-256-gcm roundtrip", () => {
  const key = crypto.randomBytes(32);
  const plaintext = "secret message";
  const enc = encryptAes256Gcm(plaintext, key);
  const dec = decryptAes256Gcm(enc, key);
  assert.equal(dec, plaintext);
});
