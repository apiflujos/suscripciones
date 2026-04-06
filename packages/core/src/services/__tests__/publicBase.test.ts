import { afterEach, test, expect } from "vitest";
import { getCheckoutBaseUrlsFromEnv, getPublicBaseUrlFromEnv } from "../publicBase";

const ORIGINAL_ENV = {
  APP_PUBLIC_BASE_URL: process.env.APP_PUBLIC_BASE_URL,
  NEXT_PUBLIC_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_PUBLIC_BASE_URL,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL
};

afterEach(() => {
  process.env.APP_PUBLIC_BASE_URL = ORIGINAL_ENV.APP_PUBLIC_BASE_URL;
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL = ORIGINAL_ENV.NEXT_PUBLIC_PUBLIC_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = ORIGINAL_ENV.NEXT_PUBLIC_API_BASE_URL;
});

test("getPublicBaseUrlFromEnv prioriza APP_PUBLIC_BASE_URL", () => {
  process.env.APP_PUBLIC_BASE_URL = "https://app.example.com/";
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL = "https://public.example.com";
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com";

  expect(getPublicBaseUrlFromEnv()).toBe("https://app.example.com");
});

test("getPublicBaseUrlFromEnv usa NEXT_PUBLIC_PUBLIC_BASE_URL como fallback", () => {
  process.env.APP_PUBLIC_BASE_URL = "";
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL = "https://public.example.com/";
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com";

  expect(getPublicBaseUrlFromEnv()).toBe("https://public.example.com");
});

test("getCheckoutBaseUrlsFromEnv deriva rutas públicas desde el fallback resuelto", () => {
  process.env.APP_PUBLIC_BASE_URL = "";
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL = "";
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://admin.example.com/";

  expect(getCheckoutBaseUrlsFromEnv()).toEqual({
    planBaseUrl: "https://admin.example.com/public/plan",
    subscriptionBaseUrl: "https://admin.example.com/public/suscripcion",
    cartBaseUrl: "https://admin.example.com/public/cart"
  });
});
