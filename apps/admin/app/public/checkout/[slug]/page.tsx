import type { CSSProperties } from "react";
import { PublicCheckoutForm } from "./PublicCheckoutForm";

export const dynamic = "force-dynamic";

async function fetchTemplate(slug: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/public/checkout/${encodeURIComponent(slug)}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export default async function PublicCheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const templateRes = await fetchTemplate(slug);
  if (!templateRes.ok) {
    return (
      <main className="page publicCheckoutShell" style={{ maxWidth: 680 }}>
        <div className="card cardPad">No se encontró la plantilla.</div>
      </main>
    );
  }

  const template = templateRes.json?.template || {};
  const plans = templateRes.json?.plans || [];
  const config = templateRes.json?.config || {};
  const logoUrl = config.logoUrl || "";
  const headerLogo =
    Array.isArray(template.layout?.sections)
      ? template.layout.sections.find((section: any) => section?.type === "header")?.props?.logoUrl
      : "";
  const fontFamily = config.fontFamily || "";
  const primaryColor = config.primaryColor || "";

  const styleVars = primaryColor ? ({ ["--primary" as any]: primaryColor } as CSSProperties) : {};

  return (
    <main className="page publicCheckoutShell" style={{ maxWidth: 720, ...(fontFamily ? { fontFamily } : {}), ...styleVars }}>
      <div className="card cardPad publicCheckoutCard" style={{ display: "grid", gap: 16, ...(primaryColor ? { borderColor: primaryColor } : {}) }}>
        {logoUrl && !headerLogo ? <img src={logoUrl} alt={template.name || "Checkout"} className="publicCheckoutLogo" /> : null}
        <PublicCheckoutForm template={template} plans={plans} config={config} />
      </div>
    </main>
  );
}
