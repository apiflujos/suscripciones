import { WompiTokenizeWidget } from "../../../customers/[id]/payment-method/WompiTokenizeWidget";
import { normalizeErrorParam } from "../../../lib/errorParam";
import { fetchWompiAcceptanceLinks } from "../../../lib/wompiMerchant";
import { PublicCheckoutLayout } from "../../_components/PublicCheckoutLayout";
import { PublicAlert } from "../../_components/PublicAlert";
import { PublicErrorPage } from "../../_components/PublicErrorPage";
import { PUBLIC_COPY } from "../../_components/publicCopy";

export const dynamic = "force-dynamic";

async function fetchPublicToken(token: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!apiBase) return { ok: false, status: 500, json: { error: "missing_next_public_api_base_url" } };
  const res = await fetch(`${apiBase}/public/tokenization-links/${encodeURIComponent(token)}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function fetchCheckoutConfig() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!apiBase) return { ok: false, json: { error: "missing_next_public_api_base_url" } };
  const res = await fetch(`${apiBase}/public/checkout-config`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, json };
}

export default async function PublicTokenizePage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const sp = (await searchParams) ?? {};
  const tokenRes = await fetchPublicToken(token);
  const configRes = await fetchCheckoutConfig();
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const template = tokenRes.ok ? tokenRes.json?.template || null : null;
  const layout = (template?.layout || {}) as any;
  const title = template?.publicTitle || config?.subscriptionTitle || "Activa tu suscripción";
  const subtitle = "";
  const baseDescription =
    template?.publicDescription ||
    config?.subscriptionDescription ||
    "Usamos Wompi para tokenizar tu tarjeta. No se realizan cargos en este paso.";
  const description = ["Guarda tu método de pago en un paso seguro.", baseDescription]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  const tokenErrorMessage = String(config?.tokenizationErrorMessage || "").trim();
  const contactEmail = String(config?.supportEmail || "").trim();
  const supportUrl = String(config?.supportUrl || "").trim();
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

  const publicKey = (() => {
    const raw = String(config?.wompiPublicKey || "").trim();
    if (!raw || raw.toLowerCase() === "undefined" || raw.toLowerCase() === "null") return "";
    return raw;
  })();
  const apiBaseUrl = (() => {
    const configured = String(config?.wompiApiBaseUrl || "").trim();
    if (configured) return configured;
    const activeEnv = String(config?.wompiActiveEnv || "PRODUCTION").toUpperCase();
    return activeEnv === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
  })();
  const acceptanceLinks = publicKey ? await fetchWompiAcceptanceLinks({ apiBaseUrl, publicKey }) : null;

  if (!tokenRes.ok) {
    const msg = "Este link no existe o ya no es válido. Solicita uno nuevo.";
    console.info("public_tokenize_error", {
      status: tokenRes.status,
      token,
      message: msg
    });
    return (
      <PublicErrorPage
        title={title}
        message={msg}
        logoUrl={logoUrl}
        trustText={PUBLIC_COPY.trustTokenize}
        supportHref={supportHref || undefined}
        supportLabel={supportLabel || undefined}
      />
    );
  }

  return (
    <PublicCheckoutLayout
      title={title}
      subtitle={subtitle}
      description={description}
      logoUrl={logoUrl}
      trustText={PUBLIC_COPY.trustTokenize}
      securityBullets={[
        "Tus datos de tarjeta se tokenizan con Wompi.",
        "Conexión cifrada (HTTPS/TLS).",
        "No hay cargos en este paso."
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

      {!publicKey ? (
        <PublicAlert>Servicio temporalmente no disponible. Solicita un nuevo link o intenta más tarde.</PublicAlert>
      ) : !acceptanceLinks ? (
        <PublicAlert>No pudimos cargar los terminos de Wompi. Intenta mas tarde.</PublicAlert>
      ) : (
        <form method="POST" action={`/public/tokenize/${encodeURIComponent(token)}/process`} style={{ display: "grid", gap: 10 }}>
          <WompiTokenizeWidget publicKey={publicKey} acceptance={acceptanceLinks} />
        </form>
      )}
    </PublicCheckoutLayout>
  );
}
