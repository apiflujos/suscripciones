export function normalizeErrorParam(input?: string | null) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.includes("NEXT_REDIRECT")) return "";
  return raw;
}
