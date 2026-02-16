import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";

async function fetchPublicConfig() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/public/checkout-config`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export default async function PublicThanksPage() {
  const cfgRes = await fetchPublicConfig();
  const config = cfgRes.ok ? cfgRes.json?.config || {} : {};
  const title = config.successTitle || "Gracias por tu pago";
  const subtitle = config.successSubtitle || "Tu transacción fue procesada correctamente.";
  const buttonText = config.successButtonText || "Volver";
  const redirectUrl = config.redirectUrl || "/";
  const logoUrl = config.logoUrl || "";
  const fontFamily = config.fontFamily || "";
  const primaryColor = config.primaryColor || "";

  const styleVars = primaryColor ? ({ ["--primary" as any]: primaryColor } as CSSProperties) : {};

  return (
    <main className="page publicCheckoutShell" style={{ maxWidth: 720, ...(fontFamily ? { fontFamily } : {}), ...styleVars }}>
      <div className="card cardPad publicCheckoutCard" style={{ display: "grid", gap: 16, textAlign: "center", ...(primaryColor ? { borderColor: primaryColor } : {}) }}>
        {logoUrl ? <img src={logoUrl} alt="Checkout" className="publicCheckoutLogo" /> : null}
        <div style={{ display: "grid", gap: 8 }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <p className="subtitle" style={{ margin: 0 }}>{subtitle}</p>
        </div>
        <a className="primary" href={redirectUrl} style={{ justifySelf: "center" }}>
          {buttonText}
        </a>
      </div>
    </main>
  );
}
