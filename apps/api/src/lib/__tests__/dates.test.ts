import test from "node:test";
import assert from "node:assert/strict";
import { addIntervalUtc } from "../dates";
import { PlanIntervalUnit } from "@prisma/client";

test("addIntervalUtc: adds days and weeks", () => {
  const base = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
  const d1 = addIntervalUtc(base, PlanIntervalUnit.DAY, 10);
  const d2 = addIntervalUtc(base, PlanIntervalUnit.WEEK, 2);
  assert.equal(d1.toISOString(), "2025-01-11T00:00:00.000Z");
  assert.equal(d2.toISOString(), "2025-01-15T00:00:00.000Z");
});

test("addIntervalUtc: handles month rollovers", () => {
  const jan31 = new Date(Date.UTC(2024, 0, 31, 0, 0, 0));
  const feb = addIntervalUtc(jan31, PlanIntervalUnit.MONTH, 1);
  assert.equal(feb.toISOString(), "2024-02-29T00:00:00.000Z");
});

test("addIntervalUtc: custom treated as days", () => {
  const base = new Date(Date.UTC(2025, 5, 10, 0, 0, 0));
  const d = addIntervalUtc(base, PlanIntervalUnit.CUSTOM, 5);
  assert.equal(d.toISOString(), "2025-06-15T00:00:00.000Z");
});
