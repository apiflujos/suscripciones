import type { CSSProperties } from "react";
import { WompiTokenizeWidget } from "../../../customers/[id]/payment-method/WompiTokenizeWidget";
import { getAdminApiConfig } from "../../../lib/adminApi";

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
  const contactEmail = "";
  const logoUrl = template?.logoUrl || config?.logoUrl || "";
  const fontFamily = "";
  const primaryColor = "";

  const publicKey = (() => {
    const activeEnv = String(settings?.wompi?.activeEnv || "PRODUCTION").toUpperCase();
    const wompiEnv =
      activeEnv === "SANDBOX" ? settings?.wompi?.sandbox : settings?.wompi?.production;
    return String(wompiEnv?.publicKey || "").trim();
  })();

  if (!tokenRes.ok) {
    const msg =
      tokenRes.status === 410
        ? "Este link ya fue usado o está vencido."
        : "El link no es válido.";
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

  return (
    <main className="page publicCheckoutShell" style={{ maxWidth: 860, ...(fontFamily ? { fontFamily } : {}), ...styleVars }}>
      <div className="card cardPad publicCheckoutCard" style={{ ...(primaryColor ? { borderColor: primaryColor } : {}) }}>
        <div className="publicCheckoutLayout">
          <div className="publicCheckoutIntro">
            {logoUrl ? <img src={logoUrl} alt={title} className="publicCheckoutLogo" /> : null}
            <h1 style={{ marginTop: 0 }}>{title}</h1>
            <p style={{ marginTop: 6 }}>{subtitle}</p>
            <p className="field-hint">{description}</p>
            {contactEmail ? (
              <div className="field-hint">
                ¿Necesitas ayuda? Escríbenos a {contactEmail}.
              </div>
            ) : null}
          </div>

          <div className="publicCheckoutSide">
            {sp.error ? (
              <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
                Error: {sp.error}
              </div>
            ) : null}

            {!publicKey ? (
              <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
                Servicio temporalmente no disponible.
              </div>
            ) : (
              <form method="POST" action={`/public/tokenize/${encodeURIComponent(token)}/process`} style={{ display: "grid", gap: 10 }}>
                <WompiTokenizeWidget publicKey={publicKey} />
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
