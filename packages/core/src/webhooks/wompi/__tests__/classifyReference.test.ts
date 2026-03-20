import { test, expect } from "vitest";
import { classifyReference } from "../classifyReference";

test("classifyReference: empty reference -> unknown", () => {
  expect(classifyReference("")).toEqual({ kind: "unknown", reference: "" });
  expect(classifyReference(null)).toEqual({ kind: "unknown", reference: "" });
});

test("classifyReference: SUB_ parses subscription and cycle", () => {
  expect(classifyReference("SUB_abc_3")).toEqual({
    kind: "subscription",
    subscriptionId: "abc",
    cycle: 3
  });
  expect(classifyReference("SUB_abc_notnum")).toEqual({
    kind: "subscription",
    subscriptionId: "abc",
    cycle: undefined
  });
});

test("classifyReference: ORDER_ returns order or shopify", () => {
  expect(classifyReference("ORDER_ref_123")).toEqual({
    kind: "order",
    reference: "ref",
    planId: undefined
  });
  const longPlanId = "planid-12345678901234567890";
  expect(classifyReference(`ORDER_ref_${longPlanId}`)).toEqual({
    kind: "order",
    reference: "ref",
    planId: longPlanId
  });
  expect(classifyReference("ORDER_shopify_foo")).toEqual({
    kind: "shopify",
    reference: "ORDER_shopify_foo"
  });
});

test("classifyReference: SHOPIFY_ prefix", () => {
  expect(classifyReference("SHOPIFY_abc")).toEqual({ kind: "shopify", reference: "SHOPIFY_abc" });
});
