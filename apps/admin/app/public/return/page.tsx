import { PublicCheckoutLayout } from "../_components/PublicCheckoutLayout";

export const dynamic = "force-dynamic";

async function fetchCheckoutConfig() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!apiBase) return { ok: false, json: { error: "missing_next_public_api_base_url" } };
  const res = await fetch(`${apiBase}/public/checkout-config`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, json };
}

export default async function PublicReturnPage() {
  const configRes = await fetchCheckoutConfig();
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const logoUrl = config?.logoUrl || "";
  const contactEmail = String(config?.supportEmail || "").trim();
  const supportUrl = String(config?.supportUrl || "").trim();
  const supportHref = contactEmail ? `mailto:${contactEmail}` : supportUrl;
  const supportLabel = contactEmail || supportUrl.replace(/^https?:\/\//, "");

  return (
    <PublicCheckoutLayout
      title="Listo"
      subtitle="Puedes cerrar esta ventana."
      description="Si necesitas ayuda, contacta a soporte."
      logoUrl={logoUrl}
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      maxWidth={680}
    >
      {supportHref ? (
        <a className="primary btn-compact btn-noicon" href={supportHref} style={{ width: "fit-content" }} referrerPolicy="no-referrer">
          Contactar soporte
        </a>
      ) : null}
    </PublicCheckoutLayout>
  );
}
