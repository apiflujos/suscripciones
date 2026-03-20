import { test, expect } from "vitest";
import { redactHeaders } from "../redact";

test("redactHeaders: redacts sensitive header names", () => {
  const out = redactHeaders({
    authorization: "Bearer secret",
    "x-api-key": "abc",
    "x-custom": "ok"
  });
  expect(out.authorization).toBe("[redacted]");
  expect(out["x-api-key"]).toBe("[redacted]");
  expect(out["x-custom"]).toBe("ok");
});
