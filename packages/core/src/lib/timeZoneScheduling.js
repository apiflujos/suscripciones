"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeClockTime = normalizeClockTime;
exports.getZonedParts = getZonedParts;
exports.getTimeZoneOffsetMs = getTimeZoneOffsetMs;
exports.applyClockTimeInZone = applyClockTimeInZone;
function normalizeClockTime(value, fallback = "09:00") {
    const raw = String(value || "").trim();
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(raw) ? raw : fallback;
}
function getZonedParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    });
    const values = Object.fromEntries(fmt
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]));
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute),
        second: Number(values.second)
    };
}
function getTimeZoneOffsetMs(date, timeZone) {
    const parts = getZonedParts(date, timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
    return asUtc - date.getTime();
}
function applyClockTimeInZone(date, hhmm, timeZone) {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(normalizeClockTime(hhmm));
    if (!m)
        return date;
    const hours = Number(m[1]);
    const minutes = Number(m[2]);
    const parts = getZonedParts(date, timeZone);
    const guessUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, hours, minutes, 0, 0);
    const firstPass = new Date(guessUtcMs - getTimeZoneOffsetMs(new Date(guessUtcMs), timeZone));
    const finalOffset = getTimeZoneOffsetMs(firstPass, timeZone);
    return new Date(guessUtcMs - finalOffset);
}
