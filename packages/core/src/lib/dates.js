"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toUtc = toUtc;
exports.addIntervalUtc = addIntervalUtc;
exports.formatDateTimeEs = formatDateTimeEs;
exports.getCivilDateKey = getCivilDateKey;
exports.getCivilDateAnchorUtc = getCivilDateAnchorUtc;
const client_1 = require("@prisma/client");
function daysInMonth(year, month0) {
    return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}
/**
 * Convierte una fecha a UTC explícito para evitar problemas de timezone
 * @param date - Fecha a convertir (puede estar en timezone local)
 * @returns Nueva fecha en UTC
 */
function toUtc(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}
function addIntervalUtc(date, unit, count) {
    // FIX: Asegurar que la fecha de entrada esté normalizada a UTC
    const normalizedDate = toUtc(date);
    const c = Math.max(0, Math.trunc(count || 0));
    const d = new Date(normalizedDate.getTime());
    if (unit === client_1.PlanIntervalUnit.DAY) {
        d.setUTCDate(d.getUTCDate() + c);
        return d;
    }
    if (unit === client_1.PlanIntervalUnit.WEEK) {
        d.setUTCDate(d.getUTCDate() + c * 7);
        return d;
    }
    if (unit === client_1.PlanIntervalUnit.MONTH) {
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
function formatDateTimeEs(date, timeZone = "America/Bogota") {
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
    }
    catch {
        return date.toISOString();
    }
}
function getCivilDateKey(date, timeZone = process.env.APP_TIMEZONE || "America/Bogota") {
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
function getCivilDateAnchorUtc(date, timeZone = process.env.APP_TIMEZONE || "America/Bogota") {
    const key = getCivilDateKey(date, timeZone);
    const [year, month, day] = key.split("-").map((part) => Number(part));
    return new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12, 0, 0, 0));
}
