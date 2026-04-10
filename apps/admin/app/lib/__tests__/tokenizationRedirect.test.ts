import { describe, expect, it } from "vitest";
import { resolveTokenizationRedirectBase } from "../tokenizationRedirect";

describe("resolveTokenizationRedirectBase", () => {
  it("prefiere el origen del link publico guardado", () => {
    const result = resolveTokenizationRedirectBase({
      requestUrl: "https://admin.example.com/public/tokenize/tok/process",
      storedLinkUrl: "https://checkout.example.com/public/suscripcion/tok_123?utm_source=test",
      subscriptionBaseUrl: "https://fallback.example.com/public/suscripcion"
    });

    expect(result).toBe("https://checkout.example.com");
  });

  it("usa la base de suscripcion cuando no hay link persistido", () => {
    const result = resolveTokenizationRedirectBase({
      requestUrl: "https://admin.example.com/public/tokenize/tok/process",
      subscriptionBaseUrl: "checkout.example.com/public/suscripcion"
    });

    expect(result).toBe("https://checkout.example.com");
  });

  it("cae al host del request cuando no hay configuracion publica", () => {
    const result = resolveTokenizationRedirectBase({
      requestUrl: "https://admin.example.com/public/tokenize/tok/process",
      forwardedProto: "https",
      forwardedHost: "admin.example.com"
    });

    expect(result).toBe("https://admin.example.com");
  });
});
