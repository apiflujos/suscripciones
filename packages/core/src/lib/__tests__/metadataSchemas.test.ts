import { expect, test } from "vitest";
import { getExpectedSubscriptionTotalInCents } from "../metadataSchemas";

test("getExpectedSubscriptionTotalInCents prefers subscription pricing total", () => {
  expect(
    getExpectedSubscriptionTotalInCents({
      subscriptionMetadata: { pricing: { totalInCents: 390000 } },
      planMetadata: { pricing: { totalInCents: 360000 } },
      fallback: 320000
    })
  ).toBe(390000);
});

test("getExpectedSubscriptionTotalInCents falls back to plan pricing total", () => {
  expect(
    getExpectedSubscriptionTotalInCents({
      subscriptionMetadata: { templateId: "550e8400-e29b-41d4-a716-446655440000" },
      planMetadata: { pricing: { totalInCents: 390000, shippingInCents: 30000 } },
      fallback: 360000
    })
  ).toBe(390000);
});

test("getExpectedSubscriptionTotalInCents falls back to numeric fallback", () => {
  expect(
    getExpectedSubscriptionTotalInCents({
      subscriptionMetadata: null,
      planMetadata: null,
      fallback: 360000
    })
  ).toBe(360000);
});
