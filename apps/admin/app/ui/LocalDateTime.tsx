"use client";

export function LocalDateTime({
  value,
  variant = "long"
}: {
  value?: string | Date | null;
  variant?: "long" | "short" | "stacked";
}) {
  if (!value) return <span>—</span>;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  const locale = "es-CO";
  const tz = "America/Bogota";
  if (variant === "stacked") {
    const dayMonth = d.toLocaleDateString(locale, {
      timeZone: tz,
      month: "short",
      day: "2-digit"
    });
    const time = d.toLocaleTimeString(locale, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit"
    });
    const shortDate = d.toLocaleDateString(locale, {
      timeZone: tz,
      year: "2-digit",
      month: "2-digit",
      day: "2-digit"
    });
    return (
      <span className="date-stack">
        <span className="date-stack-top">{dayMonth}</span>
        <span className="date-stack-bottom">
          {time} · {shortDate}
        </span>
      </span>
    );
  }
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
