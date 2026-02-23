import { PublicCheckoutLayout } from "../../../_components/PublicCheckoutLayout";
import { PUBLIC_COPY } from "../../../_components/publicCopy";

export const dynamic = "force-dynamic";

async function fetchPublicToken(token: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/public/tokenization-links/${encodeURIComponent(token)}?allowUsed=1`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function fetchCheckoutConfig() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/public/checkout-config`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, json };
}

export default async function PublicTokenizeSuccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: linkToken } = await params;
  const configRes = await fetchCheckoutConfig();
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const tokenRes = await fetchPublicToken(linkToken);
  const template = tokenRes.ok ? tokenRes.json?.template || null : null;
  const layout = (template?.layout || {}) as any;

  const title = String(config?.tokenizationSuccessTitle || "Gracias");
  const subtitle = "Tu método de pago quedó guardado.";
  const description =
    String(config?.tokenizationSuccessMessage || "").trim() ||
    template?.publicDescription ||
    config?.subscriptionDescription ||
    "Desde ahora podremos procesar tu suscripción de forma automática.";
  const contactEmail = String(process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim();
  const supportUrl = String(process.env.NEXT_PUBLIC_SUPPORT_URL || "").trim();
  const logoUrl = template?.logoUrl || config?.logoUrl || "";
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
  const redirectUrl = String(config?.tokenizationReturnUrl || "").trim() || "/";
  const buttonLabel = "Volver";

  return (
    <PublicCheckoutLayout
      title={title}
      subtitle={subtitle}
      description={description}
      logoUrl={logoUrl}
      trustText={PUBLIC_COPY.trustTokenize}
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      primaryColor={primaryColor}
      fontFamily={fontFamily}
      maxWidth={680}
    >
      <a className="primary" href={redirectUrl} style={{ width: "fit-content" }} referrerPolicy="no-referrer">
        {buttonLabel}
      </a>
    </PublicCheckoutLayout>
  );
}
