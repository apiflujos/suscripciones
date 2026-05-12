export function formatCivilDate(value?: string | Date | null, dateStyle: "short" | "medium" = "medium") {
  if (!value) return "—";
  const raw = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [year, month, day] = raw.split("-").map((part) => Number(part));
  if (!year || !month || !day) return "—";
  const safe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  return new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", dateStyle }).format(safe);
}

export function getCivilDayNumber(value?: string | Date | null) {
  if (!value) return null;
  const raw = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [, , day] = raw.split("-").map((part) => Number(part));
  return Number.isFinite(day) && day > 0 ? day : null;
}
