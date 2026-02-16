import type { CSSProperties } from "react";
import { fetchAdminCached, getAdminApiConfig } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

async function fetchPublicToken(token: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/public/tokenization-links/${encodeURIComponent(token)}?allowUsed=1`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export default async function PublicTokenizeSuccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: linkToken } = await params;
  const { token } = getAdminApiConfig();
  const settingsRes = token ? await fetchAdminCached("/admin/settings", { ttlMs: 1500 }) : { ok: false, json: null };
  const settings = settingsRes.ok ? settingsRes.json : null;
  const tokenRes = await fetchPublicToken(linkToken);
  const template = tokenRes.ok ? tokenRes.json?.template : null;
  const brand = (template?.branding || {}) as any;

  const title = brand?.successTitle || brand?.title || settings?.publicCheckout?.title || "Gracias";
  const subtitle = brand?.successSubtitle || settings?.publicCheckout?.subtitle || "Tu método de pago quedó guardado.";
  const description =
    brand?.description ||
    settings?.publicCheckout?.description ||
    "Desde ahora podremos procesar tu suscripción de forma automática.";
  const contactEmail = brand?.contactEmail || settings?.publicCheckout?.contactEmail || "";
  const logoUrl = brand?.logoUrl || "";
  const fontFamily = brand?.fontFamily || "";
  const primaryColor = brand?.primaryColor || "";
  const redirectUrl = brand?.redirectUrl || "";
  const buttonLabel = brand?.successButtonText || "Volver";

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
