import { PublicCheckoutLayout } from "../../../_components/PublicCheckoutLayout";
import { PUBLIC_COPY } from "../../../_components/publicCopy";
import { fetchPublicJsonAcrossBases, getPublicApiBases } from "../../../_components/publicRuntime";

export const dynamic = "force-dynamic";

export default async function PublicTokenizeSuccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: linkToken } = await params;
  const apiBases = await getPublicApiBases();
  const configRes = await fetchPublicJsonAcrossBases("/public/checkout-config", apiBases);
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const tokenRes = await fetchPublicJsonAcrossBases(`/public/tokenization-links/${encodeURIComponent(linkToken)}?allowUsed=1`, apiBases);
  const template = tokenRes.ok ? tokenRes.json?.template || null : null;
  const tenant = tokenRes.ok ? tokenRes.json?.tenant || null : null;
  const layout = (template?.layout || {}) as any;

  const title = String(config?.tokenizationSuccessTitle || "Gracias");
  const subtitle = "Tu método de pago quedó guardado.";
  const description =
    String(config?.tokenizationSuccessMessage || "").trim() ||
    template?.publicDescription ||
    config?.subscriptionDescription ||
    "Desde ahora podremos procesar tu suscripción de forma automática.";
  const contactEmail = String(config?.supportEmail || "").trim();
  const supportUrl = String(config?.supportUrl || "").trim();
  const logoUrl = (() => {
    const candidates = [template?.logoUrl, tenant?.logoUrl, config?.logoUrl];
    for (const candidate of candidates) {
      const raw = String(candidate || "").trim();
      if (raw && raw.toLowerCase() !== "undefined" && raw.toLowerCase() !== "null") return raw;
    }
    return "";
  })();
  const fontFamily = String(layout?.fontFamily || "").trim();
  const primaryColor = String(layout?.primaryColor || "").trim();
  const layoutSupportEmail = String(layout?.supportEmail || "").trim();
  const layoutSupportUrl = String(layout?.supportUrl || "").trim();
  const supportHref =
    (layoutSupportEmail ? `mailto:${layoutSupportEmail}` : layoutSupportUrl) ||
    (contactEmail ? `mailto:${contactEmail}` : supportUrl) ||
    "";
  const supportLabel =
    layoutSupportEmail ||
    layoutSupportUrl.replace(/^https?:\/\//, "") ||
    contactEmail ||
    supportUrl.replace(/^https?:\/\//, "") ||
    "";
  const redirectUrl = String(config?.tokenizationReturnUrl || config?.publicReturnUrl || "").trim() || "/";
  const buttonLabel = "Volver";

  return (
    <PublicCheckoutLayout
      title={title}
      subtitle={subtitle}
      description={description}
      logoUrl={logoUrl}
      trustText={PUBLIC_COPY.trustTokenize}
      tenantName={tenant?.name || ""}
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      primaryColor={primaryColor}
      fontFamily={fontFamily}
      maxWidth={680}
    >
      <a className="primary btn-compact btn-noicon" href={redirectUrl} style={{ width: "fit-content" }} referrerPolicy="no-referrer">
        {buttonLabel}
      </a>
    </PublicCheckoutLayout>
  );
}
