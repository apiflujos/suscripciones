export function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}
