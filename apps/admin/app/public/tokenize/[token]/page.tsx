import { WompiTokenizeWidget } from "../../../customers/[id]/payment-method/WompiTokenizeWidget";
import { normalizeErrorParam } from "../../../lib/errorParam";
import { fetchWompiAcceptanceLinks } from "../../../lib/wompiMerchant";
import { PublicCheckoutLayout } from "../../_components/PublicCheckoutLayout";
import { PublicAlert } from "../../_components/PublicAlert";
import { PublicErrorPage } from "../../_components/PublicErrorPage";
import { PUBLIC_COPY } from "../../_components/publicCopy";
import { fetchPublicJsonAcrossBases, getPublicApiBases } from "../../_components/publicRuntime";

export const dynamic = "force-dynamic";

export default async function PublicTokenizePage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const sp = (await searchParams) ?? {};
  const apiBases = await getPublicApiBases();
  const tokenRes = await fetchPublicJsonAcrossBases(`/public/tokenization-links/${encodeURIComponent(token)}`, apiBases);
  const configRes = await fetchPublicJsonAcrossBases("/public/checkout-config", apiBases);
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const template = tokenRes.ok ? tokenRes.json?.template || null : null;
  const tenant = tokenRes.ok ? tokenRes.json?.tenant || null : null;
  const layout = (template?.layout || {}) as any;
  const title = template?.publicTitle || config?.subscriptionTitle || "Activa tu suscripción";
  const subtitle = "";
  const baseDescription =
    template?.publicDescription ||
    config?.subscriptionDescription ||
    "Suscripción mensual al Club Alpha de Mercado del Vino.";
  const descriptionLines = ["Guarda tu método de pago en un paso seguro.", baseDescription]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const tokenErrorMessage = String(config?.tokenizationErrorMessage || "").trim();
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

  const publicKey = (() => {
    const raw = String(config?.wompiPublicKey || "").trim();
    if (!raw || raw.toLowerCase() === "undefined" || raw.toLowerCase() === "null") return "";
    return raw;
  })();
  const apiBaseUrl = (() => {
    const configured = String(config?.wompiApiBaseUrl || "").trim();
    if (configured) return configured;
    const activeEnv = String(config?.wompiActiveEnv || "PRODUCTION").toUpperCase();
    return activeEnv === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://api.wompi.co/v1";
  })();
  const acceptanceLinks = publicKey ? await fetchWompiAcceptanceLinks({ apiBaseUrl, publicKey }) : null;

  if (!tokenRes.ok) {
    const errorKey = String(tokenRes.json?.error || "").trim();
    const msg =
      errorKey === "token_expired"
        ? "Este link expiró. Solicita uno nuevo."
        : errorKey === "token_used"
          ? "Este link ya fue usado. Solicita uno nuevo."
          : errorKey === "token_not_found"
            ? "Este link no existe. Solicita uno nuevo."
            : errorKey === "unauthorized"
              ? "Este link no es válido. Solicita uno nuevo."
              : "Este link no existe o ya no es válido. Solicita uno nuevo.";
    console.info("public_tokenize_error", {
      status: tokenRes.status,
      message: msg
    });
    return (
      <PublicErrorPage
        title={title}
        message={msg}
        logoUrl={logoUrl}
        trustText={PUBLIC_COPY.trustTokenize}
        tenantName={tenant?.name || ""}
        supportHref={supportHref || undefined}
        supportLabel={supportLabel || undefined}
      />
    );
  }

  return (
    <PublicCheckoutLayout
      title={title}
      subtitle={subtitle}
      description={descriptionLines}
      logoUrl={logoUrl}
      trustText={PUBLIC_COPY.trustTokenize}
      tenantName={tenant?.name || ""}
      securityBullets={[
        "Tokenización directa con Wompi.",
        "Conexión cifrada (HTTPS/TLS).",
        "No realizamos cargos en este paso."
      ]}
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      primaryColor={primaryColor}
      fontFamily={fontFamily}
    >
      {normalizeErrorParam(sp.error) ? (
        <PublicAlert>
          {tokenErrorMessage || "Ocurrió un error al guardar tu método de pago."} {PUBLIC_COPY.errorGenericHelp}
        </PublicAlert>
      ) : null}

      <div className="payment-point">
        <div className="payment-point-title">Tokenización de tarjeta</div>
        <div className="payment-point-provider">
          <img src="/brand/wompi-icon.svg" alt="" />
          Procesado por Wompi
        </div>
        {!publicKey ? (
          <PublicAlert>Servicio temporalmente no disponible. Solicita un nuevo link o intenta más tarde.</PublicAlert>
        ) : !acceptanceLinks ? (
          <PublicAlert>No pudimos cargar los terminos de Wompi. Intenta mas tarde.</PublicAlert>
        ) : (
          <form method="POST" action={`/public/tokenize/${encodeURIComponent(token)}/process`} style={{ display: "grid", gap: 10 }}>
            <WompiTokenizeWidget publicKey={publicKey} acceptance={acceptanceLinks} />
          </form>
        )}
      </div>
    </PublicCheckoutLayout>
  );
}
