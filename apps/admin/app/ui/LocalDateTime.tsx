"use client";

export function LocalDateTime({ value }: { value?: string | Date | null }) {
  if (!value) return <span>—</span>;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  const locale = "es-CO";
  const tz = "America/Bogota";
  const text = d.toLocaleString(locale, {
    timeZone: tz,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  return <span>{text}</span>;
}
