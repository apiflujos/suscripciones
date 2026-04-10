type ResolveTokenizationRedirectBaseArgs = {
  requestUrl: string;
  storedLinkUrl?: string | null;
  subscriptionBaseUrl?: string | null;
  planBaseUrl?: string | null;
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  envPublicBaseUrl?: string | null;
  envRedirectBaseUrl?: string | null;
};

function ensureHttps(value: string) {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}

function normalizeOrigin(raw: string) {
  const input = ensureHttps(String(raw || "").trim());
  if (!input) return "";
  try {
    return new URL(input).origin;
  } catch {
    return "";
  }
}

export function resolveTokenizationRedirectBase(args: ResolveTokenizationRedirectBaseArgs) {
  const candidates = [
    args.storedLinkUrl,
    args.subscriptionBaseUrl,
    args.planBaseUrl,
    args.envPublicBaseUrl,
    args.envRedirectBaseUrl
  ];
  for (const candidate of candidates) {
    const normalized = normalizeOrigin(String(candidate || ""));
    if (normalized) return normalized;
  }

  const host = String(args.forwardedHost || args.host || "").trim();
  if (host) {
    const proto = String(args.forwardedProto || "").trim() || "https";
    return `${proto}://${host}`;
  }

  return new URL(args.requestUrl).origin;
}
