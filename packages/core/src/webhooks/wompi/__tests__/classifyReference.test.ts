import test from "node:test";
import assert from "node:assert/strict";
import { classifyReference } from "../classifyReference";

test("classifyReference: empty reference -> unknown", () => {
  assert.deepEqual(classifyReference(""), { kind: "unknown", reference: "" });
  assert.deepEqual(classifyReference(null), { kind: "unknown", reference: "" });
});

test("classifyReference: SUB_ parses subscription and cycle", () => {
  assert.deepEqual(classifyReference("SUB_abc_3"), {
    kind: "subscription",
    subscriptionId: "abc",
    cycle: 3
  });
  assert.deepEqual(classifyReference("SUB_abc_notnum"), {
    kind: "subscription",
    subscriptionId: "abc",
    cycle: undefined
  });
});

test("classifyReference: ORDER_ returns order or shopify", () => {
  assert.deepEqual(classifyReference("ORDER_ref_123"), {
    kind: "order",
    reference: "ref",
    planId: undefined
  });
  const longPlanId = "planid-12345678901234567890";
  assert.deepEqual(classifyReference(`ORDER_ref_${longPlanId}`), {
    kind: "order",
    reference: "ref",
    planId: longPlanId
  });
  assert.deepEqual(classifyReference("ORDER_shopify_foo"), {
    kind: "shopify",
    reference: "ORDER_shopify_foo"
  });
});

test("classifyReference: SHOPIFY_ prefix", () => {
  assert.deepEqual(classifyReference("SHOPIFY_abc"), { kind: "shopify", reference: "SHOPIFY_abc" });
});
