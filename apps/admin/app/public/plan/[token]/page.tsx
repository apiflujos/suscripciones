import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";

async function fetchPaymentLink(token: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/public/payment-links/${encodeURIComponent(token)}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function fetchCheckoutConfig() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/public/checkout-config`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, json };
}

export default async function PublicPlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const linkRes = await fetchPaymentLink(token);
  const configRes = await fetchCheckoutConfig();
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const template = linkRes.ok ? linkRes.json?.template || null : null;
  const title = template?.publicTitle || config?.planTitle || "Paga tu plan";
  const description = template?.publicDescription || config?.planDescription || "";
  const logoUrl = template?.logoUrl || config?.logoUrl || "";
  const primaryColor = "";
  const fontFamily = "";

  if (!linkRes.ok) {
    const msg = linkRes.status === 410 ? "Este link está vencido." : "El link no es válido.";
    return (
      <main className="page" style={{ maxWidth: 680 }}>
        <div className="card cardPad">
          <h1 style={{ marginTop: 0 }}>{title}</h1>
          <p>{msg}</p>
        </div>
      </main>
    );
  }

  const styleVars = primaryColor ? ({ ["--primary" as any]: primaryColor } as CSSProperties) : {};
  const customer = linkRes.json?.customer || {};
  const checkoutUrl = linkRes.json?.checkoutUrl || "";

  return (
    <main className="page publicCheckoutShell" style={{ maxWidth: 860, ...(fontFamily ? { fontFamily } : {}), ...styleVars }}>
      <div className="card cardPad publicCheckoutCard">
        <div className="publicCheckoutLayout">
          <div className="publicCheckoutIntro">
            {logoUrl ? <img src={logoUrl} alt={title} className="publicCheckoutLogo" /> : null}
            <h1 style={{ marginTop: 0 }}>{title}</h1>
            {description ? <p className="field-hint">{description}</p> : null}
          </div>

          <div className="publicCheckoutSide">
            <div className="field">
              <label>Nombre completo</label>
              <input className="input" readOnly value={customer.name || ""} />
            </div>
            <div className="field">
              <label>Teléfono</label>
              <input className="input" readOnly value={customer.phone || ""} />
            </div>
            <a className="primary" href={checkoutUrl}>
              Pagar
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
