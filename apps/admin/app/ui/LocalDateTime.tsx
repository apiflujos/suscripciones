"use client";

export function LocalDateTime({ value, variant = "long" }: { value?: string | Date | null; variant?: "long" | "short" }) {
  if (!value) return <span>—</span>;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  const locale = "es-CO";
  const tz = "America/Bogota";
  const text =
    variant === "short"
      ? d.toLocaleString(locale, {
          timeZone: tz,
          year: "2-digit",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        })
      : d.toLocaleString(locale, {
          timeZone: tz,
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        });
  return <span>{text}</span>;
}
