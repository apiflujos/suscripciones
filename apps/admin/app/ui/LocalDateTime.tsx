"use client";

export function LocalDateTime({ value }: { value?: string | Date | null }) {
  if (!value) return <span>—</span>;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  const locale = typeof navigator !== "undefined" ? navigator.language : undefined;
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const text = d.toLocaleString(locale || undefined, tz ? { timeZone: tz } : undefined);
  return <span>{text}</span>;
}
