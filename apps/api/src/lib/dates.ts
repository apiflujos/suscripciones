import { PlanIntervalUnit } from "@prisma/client";

function daysInMonth(year: number, month0: number) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function addIntervalUtc(date: Date, unit: PlanIntervalUnit, count: number): Date {
  const c = Math.max(0, Math.trunc(count || 0));
  const d = new Date(date.getTime());

  if (unit === PlanIntervalUnit.DAY) {
    d.setUTCDate(d.getUTCDate() + c);
    return d;
  }
  if (unit === PlanIntervalUnit.WEEK) {
    d.setUTCDate(d.getUTCDate() + c * 7);
    return d;
  }
  if (unit === PlanIntervalUnit.MONTH) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const targetMonth = m + c;
    const targetYear = y + Math.floor(targetMonth / 12);
    const month0 = ((targetMonth % 12) + 12) % 12;
    const last = daysInMonth(targetYear, month0);
    d.setUTCFullYear(targetYear);
    d.setUTCMonth(month0);
    d.setUTCDate(Math.min(day, last));
    return d;
  }

  // CUSTOM: treat as days (count already in days).
  d.setUTCDate(d.getUTCDate() + c);
  return d;
}

