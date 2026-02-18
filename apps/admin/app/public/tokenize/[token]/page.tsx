import { WompiTokenizeWidget } from "../../../customers/[id]/payment-method/WompiTokenizeWidget";
import { getAdminApiConfig } from "../../../lib/adminApi";
import { PublicCheckoutLayout } from "../../_components/PublicCheckoutLayout";
import { PublicAlert } from "../../_components/PublicAlert";
import { PublicErrorPage } from "../../_components/PublicErrorPage";
import { PUBLIC_COPY } from "../../_components/publicCopy";

export const dynamic = "force-dynamic";

async function fetchPublicToken(token: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/public/tokenization-links/${encodeURIComponent(token)}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function fetchCheckoutConfig() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
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
  const { token: adminToken } = getAdminApiConfig();
  const settingsRes = adminToken
    ? await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001"}/admin/settings`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${adminToken}`, "x-admin-token": adminToken }
      })
    : null;
  const settings = settingsRes && "ok" in settingsRes ? await (settingsRes as any).json().catch(() => null) : null;
  const title = template?.publicTitle || config?.subscriptionTitle || "Activa tu suscripción";
  const subtitle = "Guarda tu método de pago en un paso seguro.";
  const description =
    template?.publicDescription ||
    config?.subscriptionDescription ||
    "Usamos Wompi para tokenizar tu tarjeta. No se realizan cargos en este paso.";
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

  const publicKey = (() => {
    const activeEnv = String(settings?.wompi?.activeEnv || "PRODUCTION").toUpperCase();
    const wompiEnv =
      activeEnv === "SANDBOX" ? settings?.wompi?.sandbox : settings?.wompi?.production;
    return String(wompiEnv?.publicKey || "").trim();
  })();

  if (!tokenRes.ok) {
    const msg = tokenRes.status === 410 ? PUBLIC_COPY.errorUsedLink : PUBLIC_COPY.errorInvalidLink;
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
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      primaryColor={primaryColor}
      fontFamily={fontFamily}
    >
      {sp.error ? (
        <PublicAlert>
          Ocurrió un error: {sp.error}. {PUBLIC_COPY.errorGenericHelp}
        </PublicAlert>
      ) : null}

      {!publicKey ? (
        <PublicAlert>Servicio temporalmente no disponible. Solicita un nuevo link o intenta más tarde.</PublicAlert>
      ) : (
        <form method="POST" action={`/public/tokenize/${encodeURIComponent(token)}/process`} style={{ display: "grid", gap: 10 }}>
          <WompiTokenizeWidget publicKey={publicKey} />
        </form>
      )}
    </PublicCheckoutLayout>
  );
}
