import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicCheckoutKind } from "@prisma/client";

const { findTemplateMock, findCustomerMock, updateCustomerMock } = vi.hoisted(() => ({
  findTemplateMock: vi.fn(),
  findCustomerMock: vi.fn(),
  updateCustomerMock: vi.fn()
}));

const { getCredentialMock } = vi.hoisted(() => ({
  getCredentialMock: vi.fn()
}));

const { signPublicTokenMock } = vi.hoisted(() => ({
  signPublicTokenMock: vi.fn()
}));

vi.mock("../../db/prisma", () => ({
  prisma: {
    publicCheckoutTemplate: { findUnique: findTemplateMock },
    customer: { findUnique: findCustomerMock, update: updateCustomerMock }
  }
}));

vi.mock("../credentials", () => ({
  getCredential: getCredentialMock
}));

vi.mock("../publicBase", () => ({
  getCheckoutBaseUrlsFromEnv: vi.fn(() => ({
    planBaseUrl: null,
    subscriptionBaseUrl: null,
    cartBaseUrl: null
  }))
}));

vi.mock("../publicTokens", () => ({
  signPublicToken: signPublicTokenMock
}));

import { createPublicCheckoutLink } from "../publicCheckoutLinks";

describe("publicCheckoutLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredentialMock.mockResolvedValue(JSON.stringify({ planBaseUrl: "https://checkout.example.com/public/plan" }));
    findCustomerMock.mockResolvedValue({ metadata: {} });
    updateCustomerMock.mockResolvedValue({ id: "cus-1" });
    signPublicTokenMock.mockResolvedValue("jwt-token");
  });

  it("uses cart scope and persists cart metadata", async () => {
    findTemplateMock.mockResolvedValue({
      id: "tpl-cart",
      tenantId: "tenant-1",
      name: "Catalogo",
      kind: PublicCheckoutKind.CART,
      active: true,
      expiryHours: 24,
      utmParams: "src=test"
    });

    const result = await createPublicCheckoutLink({ customerId: "cus-1", templateId: "tpl-cart" });

    expect(signPublicTokenMock).toHaveBeenCalledWith(expect.objectContaining({ sub: "cus-1", scope: "cart" }));
    expect(updateCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cus-1" },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            cartLink: expect.objectContaining({
              token: "jwt-token",
              templateId: "tpl-cart",
              kind: PublicCheckoutKind.CART
            })
          })
        })
      })
    );
    expect(result?.url).toContain("/public/cart/jwt-token");
  });

  it("preserves checkoutUrl when generating a public payment checkout", async () => {
    findTemplateMock.mockResolvedValue({
      id: "tpl-plan",
      tenantId: "tenant-1",
      name: "Plan publico",
      kind: PublicCheckoutKind.PLAN,
      active: true,
      expiryHours: 24,
      utmParams: null
    });

    await createPublicCheckoutLink({
      customerId: "cus-1",
      templateId: "tpl-plan",
      checkoutUrl: "https://wompi.test/checkout/abc"
    });

    expect(updateCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            paymentLink: expect.objectContaining({
              checkoutUrl: "https://wompi.test/checkout/abc",
              templateId: "tpl-plan"
            })
          })
        })
      })
    );
  });

  it("does not inherit stale planId or productId when generating a new tokenization link", async () => {
    getCredentialMock.mockResolvedValue(
      JSON.stringify({ subscriptionBaseUrl: "https://checkout.example.com/public/suscripcion" })
    );
    findTemplateMock.mockResolvedValue({
      id: "tpl-sub",
      tenantId: "tenant-1",
      name: "Suscripcion publica",
      kind: PublicCheckoutKind.SUBSCRIPTION,
      active: true,
      expiryHours: 24,
      utmParams: null
    });
    findCustomerMock.mockResolvedValue({
      metadata: {
        tokenizationLink: {
          planId: "old-plan",
          productId: "old-product"
        }
      }
    });

    await createPublicCheckoutLink({
      customerId: "cus-1",
      templateId: "tpl-sub",
      productId: "new-product"
    });

    expect(updateCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            tokenizationLink: expect.objectContaining({
              planId: null,
              productId: "new-product"
            })
          })
        })
      })
    );
  });
});
