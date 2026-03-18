type HeaderValue = string | string[] | number | boolean | null | undefined;

const SENSITIVE_HEADER_PARTS = ["authorization", "token", "api_key", "api-key", "apikey", "secret", "signature"];

export function redactHeaders(headers: Record<string, HeaderValue>) {
  const out: Record<string, HeaderValue> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    const isSensitive = SENSITIVE_HEADER_PARTS.some((p) => lower.includes(p));
    out[key] = isSensitive ? "[redacted]" : value;
  }
  return out;
}
