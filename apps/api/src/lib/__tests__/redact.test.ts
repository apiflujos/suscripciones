import test from "node:test";
import assert from "node:assert/strict";
import { redactHeaders } from "../redact";

test("redactHeaders: redacts sensitive header names", () => {
  const out = redactHeaders({
    authorization: "Bearer secret",
    "x-api-key": "abc",
    "x-custom": "ok"
  });
  assert.equal(out.authorization, "[redacted]");
  assert.equal(out["x-api-key"], "[redacted]");
  assert.equal(out["x-custom"], "ok");
});
