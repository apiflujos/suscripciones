import { describe, expect, it } from "vitest";
import { linkResendWindowMs, MIN_LINK_RESEND_GAP_MS } from "../collectionAttempts";

const DAY = 24 * 60 * 60 * 1000;

describe("linkResendWindowMs", () => {
  it("sin reintentos solo rige el mínimo", () => {
    expect(linkResendWindowMs({ retryEnabled: false, retryEveryMinutes: 4320 })).toBe(MIN_LINK_RESEND_GAP_MS);
  });

  it("con reintentos manda el 'cada' configurado", () => {
    expect(linkResendWindowMs({ retryEnabled: true, retryEveryMinutes: 3 * 24 * 60 })).toBe(3 * DAY);
  });

  it("nunca baja del mínimo ni se rompe con valores inválidos", () => {
    expect(linkResendWindowMs({ retryEnabled: true, retryEveryMinutes: 10 })).toBe(MIN_LINK_RESEND_GAP_MS);
    expect(linkResendWindowMs({ retryEnabled: true, retryEveryMinutes: null })).toBe(MIN_LINK_RESEND_GAP_MS);
    expect(linkResendWindowMs({})).toBe(MIN_LINK_RESEND_GAP_MS);
  });
});
