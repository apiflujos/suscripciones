import { test, expect } from "vitest";
import { addIntervalUtc, formatDateEs } from "../dates";
import { PlanIntervalUnit } from "@prisma/client";

test("addIntervalUtc: adds days and weeks", () => {
  const base = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
  const d1 = addIntervalUtc(base, PlanIntervalUnit.DAY, 10);
  const d2 = addIntervalUtc(base, PlanIntervalUnit.WEEK, 2);
  expect(d1.toISOString()).toBe("2025-01-11T00:00:00.000Z");
  expect(d2.toISOString()).toBe("2025-01-15T00:00:00.000Z");
});

test("addIntervalUtc: handles month rollovers", () => {
  const jan31 = new Date(Date.UTC(2024, 0, 31, 0, 0, 0));
  const feb = addIntervalUtc(jan31, PlanIntervalUnit.MONTH, 1);
  expect(feb.toISOString()).toBe("2024-02-29T00:00:00.000Z");
});

test("addIntervalUtc: custom treated as days", () => {
  const base = new Date(Date.UTC(2025, 5, 10, 0, 0, 0));
  const d = addIntervalUtc(base, PlanIntervalUnit.CUSTOM, 5);
  expect(d.toISOString()).toBe("2025-06-15T00:00:00.000Z");
});

// Un vencimiento cae a medianoche, así que anunciarlo con hora ("20 de agosto de
// 2026 12:00 a. m.") le dice al cliente algo que no significa nada. El
// recordatorio de cobro usa esta variante sin hora.
test("formatDateEs: fecha sin hora en la zona horaria pedida", () => {
  const dueAt = new Date("2026-08-20T05:00:00.000Z"); // medianoche en Bogotá
  const formatted = formatDateEs(dueAt, "America/Bogota");
  expect(formatted).toContain("20");
  expect(formatted).toContain("agosto");
  expect(formatted).toContain("2026");
  expect(formatted).not.toMatch(/\d{1,2}:\d{2}/);
});

test("formatDateEs: la zona horaria decide el día, no UTC", () => {
  const dueAt = new Date("2026-08-20T03:00:00.000Z"); // aún es 19 en Bogotá
  expect(formatDateEs(dueAt, "America/Bogota")).toContain("19");
  expect(formatDateEs(dueAt, "UTC")).toContain("20");
});
