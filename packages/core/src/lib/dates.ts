import { PlanIntervalUnit } from "@prisma/client";

function daysInMonth(year: number, month0: number) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Convierte una fecha a UTC explícito para evitar problemas de timezone
 * @param date - Fecha a convertir (puede estar en timezone local)
 * @returns Nueva fecha en UTC
 */
export function toUtc(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ));
}

export function addIntervalUtc(date: Date, unit: PlanIntervalUnit, count: number): Date {
  // FIX: Asegurar que la fecha de entrada esté normalizada a UTC
  const normalizedDate = toUtc(date);
  const c = Math.max(0, Math.trunc(count || 0));
  const d = new Date(normalizedDate.getTime());

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
    // Avoid JS date overflow when current day doesn't exist in target month.
    d.setUTCDate(1);
    d.setUTCMonth(month0);
    d.setUTCDate(Math.min(day, last));
    return d;
  }

  // CUSTOM: treat as days (count already in days).
  d.setUTCDate(d.getUTCDate() + c);
  return d;
}

/**
 * Fecha sin hora, para lo que el cliente lee como un día y no como un instante.
 * El vencimiento de un ciclo es medianoche: anunciarlo como "20 de agosto de 2026
 * 12:00 a. m." no le dice nada a nadie y parece un error del sistema.
 */
export function formatDateEs(date: Date, timeZone: string = "America/Bogota") {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone,
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatDateTimeEs(date: Date, timeZone: string = "America/Bogota") {
  try {
    const fmt = new Intl.DateTimeFormat("es-CO", {
      timeZone,
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    return fmt.format(date).replace(",", "");
  } catch {
    return date.toISOString();
  }
}

export function getCivilDateKey(date: Date, timeZone: string = process.env.APP_TIMEZONE || "America/Bogota") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

export function getCivilDateAnchorUtc(date: Date, timeZone: string = process.env.APP_TIMEZONE || "America/Bogota") {
  const key = getCivilDateKey(date, timeZone);
  const [year, month, day] = key.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12, 0, 0, 0));
}
