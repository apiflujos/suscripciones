export function fmtMoneyCop(cents: number) {
  const v = (Number(cents || 0) / 100).toFixed(0);
  return new Intl.NumberFormat("es-CO").format(Number(v));
}

export function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(1)}%`;
}

export function fmtDelta(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

export function fmtDeltaPp(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(1)} pp`;
}

export function fmtShortDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTimeShort(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtBucketLabel(isoStr: string, g: "day" | "week" | "month") {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  if (g === "month") return d.toLocaleDateString("es-CO", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

export function sum(values: number[]) {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

export function avg(values: number[]) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

export function alignSeries(values: number[], targetLength: number) {
  if (values.length === targetLength) return values;
  if (values.length > targetLength) return values.slice(values.length - targetLength);
  const pad = Array.from({ length: Math.max(0, targetLength - values.length) }, () => 0);
  return [...pad, ...values];
}

export function pctChange(current: number, prev: number) {
  if (!Number.isFinite(current) || !Number.isFinite(prev) || prev === 0) return null;
  return ((current - prev) / Math.abs(prev)) * 100;
}

export function paymentStatusPill(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED") return { cls: "pill-ok", label: "Aprobado" };
  if (s === "PENDING") return { cls: "pill-warn", label: "Pendiente" };
  if (["DECLINED", "ERROR", "VOIDED"].includes(s)) return { cls: "pill-bad", label: "Fallido" };
  return { cls: "pill-muted", label: s || "—" };
}

export function toUtcIsoStart(dateStr: string) {
  const [y, m, d] = String(dateStr || "").split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)).toISOString();
}

export function toUtcIsoEndExclusive(dateStr: string) {
  const [y, m, d] = String(dateStr || "").split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0)).toISOString();
}

export function isoDateUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
    .toISOString()
    .slice(0, 10);
}

export function isoDateFromTimestamp(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
