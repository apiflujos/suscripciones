export type ConnectionSlug = "wompi-prod" | "wompi-sandbox" | "chatwoot" | "shopify";

export const CONNECTION_SLUGS: ConnectionSlug[] = ["wompi-prod", "wompi-sandbox", "chatwoot", "shopify"];

export const CONNECTION_TITLES: Record<ConnectionSlug, string> = {
  "wompi-prod": "Wompi · Producción",
  "wompi-sandbox": "Wompi · Sandbox",
  chatwoot: "Chatwoot · WhatsApp",
  shopify: "Shopify"
};

export const CONNECTIONS_LIST_HREF = "/settings?tab=connections";

export function isConnectionSlug(value: string): value is ConnectionSlug {
  return (CONNECTION_SLUGS as string[]).includes(value);
}

/** Enlaces antiguos (`?tab=connections&open=wompi|wompi_prod|wompi_sandbox|central|shopify`) → página nueva. */
export function slugFromLegacyOpen(open: string): ConnectionSlug | null {
  if (open === "wompi" || open === "wompi_prod") return "wompi-prod";
  if (open === "wompi_sandbox") return "wompi-sandbox";
  if (open === "central") return "chatwoot";
  if (open === "shopify") return "shopify";
  return null;
}

export function connectionHref(slug: ConnectionSlug, opts?: { returnTo?: string; confirmDelete?: boolean }) {
  const qs = new URLSearchParams();
  if (opts?.returnTo) qs.set("returnTo", opts.returnTo);
  if (opts?.confirmDelete) qs.set("confirmDelete", "1");
  const s = qs.toString();
  return `/settings/connections/${slug}${s ? `?${s}` : ""}`;
}
