import { PublicCheckoutLayout } from "../_components/PublicCheckoutLayout";
import { PublicAlert } from "../_components/PublicAlert";

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
    <PublicCheckoutLayout
      title="Link incompleto"
      subtitle="Falta el token de la suscripcion."
      description="Verifica el enlace o solicita un nuevo link."
      logoUrl={logoUrl}
      trustText="Pago seguro con Wompi."
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      maxWidth={680}
    >
      <PublicAlert>Este enlace no es valido sin el token.</PublicAlert>
    </PublicCheckoutLayout>
  );
}
