import { describe, expect, it } from "vitest";
import { isSendWindowOpen } from "../sendWindow";

// Bogotá es UTC-5 todo el año.
const at = (bogotaHhmm: string) => new Date(`2026-10-30T${bogotaHhmm}:00-05:00`);

describe("isSendWindowOpen", () => {
  it("abre de 08:00 a 20:00 por defecto", () => {
    expect(isSendWindowOpen(at("07:59"), {})).toBe(false);
    expect(isSendWindowOpen(at("08:00"), {})).toBe(true);
    expect(isSendWindowOpen(at("19:59"), {})).toBe(true);
    expect(isSendWindowOpen(at("20:00"), {})).toBe(false);
    expect(isSendWindowOpen(at("23:30"), {})).toBe(false);
    expect(isSendWindowOpen(at("03:00"), {})).toBe(false);
  });

  it("respeta la configuración y ventanas que cruzan la medianoche", () => {
    const env = { SEND_WINDOW_START: "22:00", SEND_WINDOW_END: "06:00" } as NodeJS.ProcessEnv;
    expect(isSendWindowOpen(at("23:00"), env)).toBe(true);
    expect(isSendWindowOpen(at("05:00"), env)).toBe(true);
    expect(isSendWindowOpen(at("12:00"), env)).toBe(false);
  });

  it("inicio igual a fin significa sin restricción", () => {
    const env = { SEND_WINDOW_START: "00:00", SEND_WINDOW_END: "00:00" } as NodeJS.ProcessEnv;
    expect(isSendWindowOpen(at("03:00"), env)).toBe(true);
  });
});
