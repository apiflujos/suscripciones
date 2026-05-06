import { test, expect } from "vitest";
import { classifyReference, isShopifyLikePayload, isShopifyLikePayment } from "../classifyReference";

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

test("isShopifyLikePayment: detects Shopify by non-reference signals", () => {
  expect(
    isShopifyLikePayment({
      reference: "r3uEYBDiJC1kpV3cxDVvyMUIX",
      origin: "shopify"
    })
  ).toBe(true);

  expect(
    isShopifyLikePayment({
      reference: "random-reference",
      redirectUrl: "https://wompi-integracion-ecommerce-api-prod.conexa.ai/wompi/continue-checkout/random-reference"
    })
  ).toBe(true);

  expect(
    isShopifyLikePayment({
      reference: "random-reference",
      source: "wompi"
    })
  ).toBe(false);
});

test("isShopifyLikePayload: detects Shopify webhook payloads beyond reference", () => {
  expect(
    isShopifyLikePayload({
      data: {
        transaction: {
          reference: "r3uEYBDiJC1kpV3cxDVvyMUIX",
          origin: "shopify"
        }
      }
    })
  ).toBe(true);

  expect(
    isShopifyLikePayload({
      data: {
        transaction: {
          reference: "random-reference",
          redirect_url: "https://wompi-integracion-ecommerce-api-prod.conexa.ai/wompi/continue-checkout/random-reference"
        }
      }
    })
  ).toBe(true);

  expect(
    isShopifyLikePayload({
      data: {
        transaction: {
          reference: "random-reference",
          origin: "wompi"
        }
      }
    })
  ).toBe(false);
});
