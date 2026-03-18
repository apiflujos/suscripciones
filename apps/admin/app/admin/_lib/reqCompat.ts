type QueryValue = string | string[];

function buildQuery(url: URL): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }
  return out;
}

export function reqToCompat(req: Request, body?: any) {
  const url = new URL(req.url);
  const headersObj = Object.fromEntries(req.headers.entries());
  return {
    query: buildQuery(url),
    body,
    headers: headersObj,
    header: (name: string) => {
      if (!name) return undefined;
      const key = name.toLowerCase();
      return req.headers.get(key) ?? req.headers.get(name) ?? undefined;
    },
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined
  };
}
