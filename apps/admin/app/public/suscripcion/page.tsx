import { PublicErrorPage } from "../_components/PublicErrorPage";

export const dynamic = "force-dynamic";

async function fetchCheckoutConfig() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!apiBase) return { ok: false, json: { error: "missing_next_public_api_base_url" } };
  const res = await fetch(`${apiBase}/public/checkout-config`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, json };
}

export default async function PublicSubscriptionMissingPage() {
  const configRes = await fetchCheckoutConfig();
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const logoUrl = config?.logoUrl || "";
  const contactEmail = String(config?.supportEmail || "").trim();
  const supportUrl = String(config?.supportUrl || "").trim();
  const supportHref = contactEmail ? `mailto:${contactEmail}` : supportUrl;
  const supportLabel = contactEmail || supportUrl.replace(/^https?:\/\//, "");

  return (
    <PublicErrorPage
      title="Link no válido"
      message="Este link no existe o ya no es válido. Solicita uno nuevo."
      logoUrl={logoUrl}
      trustText="Pago seguro con Wompi."
      tenantName=""
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
    />
  );
}
