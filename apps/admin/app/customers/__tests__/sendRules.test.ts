import { describe, expect, it } from "vitest";
import { mapSendError, preferredCatalogMode, resolveActionBlockReason, type SendContext } from "../sendRules";

const template = (trigger: string, name = "tpl") => ({ id: `t-${trigger}`, chatwootTemplate: { name } });

function ctx(over: Partial<SendContext> = {}): SendContext {
  return {
    customer: { id: "c1", tenantId: "ten1" },
    productId: "p1",
    checkoutTemplates: [
      { id: "k1", active: true, kind: "PLAN", tenantId: "ten1", productIds: ["p1"] },
      { id: "k2", active: true, kind: "SUBSCRIPTION", tenantId: "ten1", productIds: [{ id: "p1", mode: "AUTO_DEBIT" }] },
      { id: "k3", active: true, kind: "CART", tenantId: null, productIds: [] }
    ],
    checkoutConfig: { planBaseUrl: "https://p", subscriptionBaseUrl: "https://s", defaultCartTemplateId: "k3" },
    notificationsConfig: {
      rules: [
        { id: "r1", trigger: "PAYMENT_LINK_CREATED", templateId: "t-PAYMENT_LINK_CREATED" },
        { id: "r2", trigger: "TOKENIZATION_LINK_CREATED", templateId: "t-TOKENIZATION_LINK_CREATED" },
        { id: "r3", trigger: "CATALOG_LINK_CREATED", templateId: "t-CATALOG_LINK_CREATED" }
      ],
      templates: [template("PAYMENT_LINK_CREATED"), template("TOKENIZATION_LINK_CREATED"), template("CATALOG_LINK_CREATED")]
    },
    ...over
  };
}

describe("resolveActionBlockReason", () => {
  it("permite enviar cuando todo está configurado", () => {
    expect(resolveActionBlockReason(ctx(), "PAYMENT")).toBe("");
    expect(resolveActionBlockReason(ctx(), "TOKEN")).toBe("");
    expect(resolveActionBlockReason(ctx(), "CATALOG_PLAN")).toBe("");
    expect(resolveActionBlockReason(ctx(), "CATALOG_SUBSCRIPTION")).toBe("");
  });

  it("link y débito exigen producto; el catálogo no", () => {
    const c = ctx({ productId: "" });
    expect(resolveActionBlockReason(c, "PAYMENT")).toBe("missing_product_for_customer");
    expect(resolveActionBlockReason(c, "TOKEN")).toBe("missing_product_for_customer");
    expect(resolveActionBlockReason(c, "CATALOG_PLAN")).toBe("");
  });

  it("avisa de la URL base y de la plantilla que faltan", () => {
    expect(resolveActionBlockReason(ctx({ checkoutConfig: {} }), "PAYMENT")).toBe("missing_plan_base_url");
    expect(resolveActionBlockReason(ctx({ checkoutConfig: { planBaseUrl: "x", defaultCartTemplateId: "k3" } }), "TOKEN")).toBe(
      "missing_subscription_base_url"
    );
    expect(resolveActionBlockReason(ctx({ notificationsConfig: { rules: [], templates: [] } }), "PAYMENT")).toBe("missing_template");
  });

  it("sin checkout para el producto, lo dice", () => {
    expect(resolveActionBlockReason(ctx({ checkoutTemplates: [] }), "PAYMENT")).toBe("missing_checkout_for_product");
    expect(resolveActionBlockReason(ctx({ checkoutTemplates: [], productId: "" }), "CATALOG_PLAN")).toBe("missing_cart_template");
  });

  it("ignora checkouts inactivos o de otro canal", () => {
    const c = ctx({ checkoutTemplates: [{ id: "k1", active: false, kind: "PLAN", tenantId: "ten1", productIds: ["p1"] }] });
    expect(resolveActionBlockReason(c, "PAYMENT")).toBe("missing_checkout_for_product");
    const other = ctx({ checkoutTemplates: [{ id: "k1", active: true, kind: "PLAN", tenantId: "otro", productIds: ["p1"] }] });
    expect(resolveActionBlockReason(other, "PAYMENT")).toBe("missing_checkout_for_product");
  });
});

describe("preferredCatalogMode", () => {
  it("propone el modo de la suscripción si se puede enviar", () => {
    expect(preferredCatalogMode(ctx(), "AUTO_DEBIT")).toBe("SUBSCRIPTION");
    expect(preferredCatalogMode(ctx(), "AUTO_LINK")).toBe("PLAN");
  });
  it("cae al otro modo si el preferido está bloqueado", () => {
    const c = ctx({ checkoutConfig: { planBaseUrl: "https://p", defaultCartTemplateId: "k3" } });
    expect(preferredCatalogMode(c, "AUTO_DEBIT")).toBe("PLAN");
  });
});

describe("mapSendError", () => {
  it("traduce códigos conocidos y deja pasar el resto", () => {
    expect(mapSendError("missing_template")).toMatch(/plantilla WhatsApp/);
    expect(mapSendError("auth_required")).toMatch(/Sesión vencida/);
    expect(mapSendError("algo raro")).toBe("algo raro");
    expect(mapSendError("")).toBe("No se pudo enviar el mensaje.");
  });
});
