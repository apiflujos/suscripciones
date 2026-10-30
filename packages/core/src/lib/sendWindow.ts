import { getZonedParts, normalizeClockTime } from "./timeZoneScheduling";

/**
 * Ventana en la que se permiten los envíos automáticos al cliente (recordatorios,
 * campañas y reintentos de cobro, que a su vez mandan links y avisos).
 * Fuera de ella el trabajo queda pendiente y sale cuando la ventana abre.
 *
 * Configurable con SEND_WINDOW_START / SEND_WINDOW_END (HH:mm) y
 * SEND_WINDOW_TIMEZONE. Por defecto 08:00–20:00 hora de Bogotá.
 */
export function getSendWindow(env: NodeJS.ProcessEnv = process.env) {
  return {
    start: normalizeClockTime(env.SEND_WINDOW_START, "08:00"),
    end: normalizeClockTime(env.SEND_WINDOW_END, "20:00"),
    timeZone: String(env.SEND_WINDOW_TIMEZONE || env.APP_TIMEZONE || "America/Bogota").trim() || "America/Bogota"
  };
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isSendWindowOpen(now: Date = new Date(), env: NodeJS.ProcessEnv = process.env) {
  const { start, end, timeZone } = getSendWindow(env);
  const parts = getZonedParts(now, timeZone);
  const current = parts.hour * 60 + parts.minute;
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === to) return true;
  return from < to ? current >= from && current < to : current >= from || current < to;
}
