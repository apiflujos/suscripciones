import type { CSSProperties } from "react";

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

  const title = "Gracias";
  const subtitle = "Tu método de pago quedó guardado.";
  const description =
    template?.publicDescription ||
    config?.subscriptionDescription ||
    "Desde ahora podremos procesar tu suscripción de forma automática.";
  const contactEmail = "";
  const logoUrl = template?.logoUrl || config?.logoUrl || "";
  const fontFamily = "";
  const primaryColor = "";
  const redirectUrl = "";
  const buttonLabel = "Volver";

  const styleVars = primaryColor ? ({ ["--primary" as any]: primaryColor } as CSSProperties) : {};

  return (
    <main className="page publicCheckoutShell" style={{ maxWidth: 680, ...(fontFamily ? { fontFamily } : {}), ...styleVars }}>
      <div className="card cardPad publicCheckoutCard" style={{ display: "grid", gap: 12, ...(primaryColor ? { borderColor: primaryColor } : {}) }}>
        <div>
          {logoUrl ? <img src={logoUrl} alt={title} className="publicCheckoutLogo" /> : null}
          <h1 style={{ marginTop: 0 }}>{title}</h1>
          <p style={{ marginTop: 6 }}>{subtitle}</p>
          <p className="field-hint">{description}</p>
        </div>
        {redirectUrl ? (
          <a className="primary" href={redirectUrl} style={{ width: "fit-content" }}>
            {buttonLabel}
          </a>
        ) : null}
        {contactEmail ? (
          <div className="field-hint">
            ¿Necesitas ayuda? Escríbenos a {contactEmail}.
          </div>
        ) : null}
      </div>
    </main>
  );
}
