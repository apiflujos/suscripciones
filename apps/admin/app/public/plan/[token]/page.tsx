import { PublicCheckoutLayout } from "../../_components/PublicCheckoutLayout";
import { PublicAlert } from "../../_components/PublicAlert";
import { PublicErrorPage } from "../../_components/PublicErrorPage";
import { PUBLIC_COPY } from "../../_components/publicCopy";

export const dynamic = "force-dynamic";

async function fetchPaymentLink(token: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!apiBase) return { ok: false, status: 500, json: { error: "missing_next_public_api_base_url" } };
  const res = await fetch(`${apiBase}/public/payment-links/${encodeURIComponent(token)}`, { cache: "no-store" });
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

export default async function PublicPlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const linkRes = await fetchPaymentLink(token);
  const configRes = await fetchCheckoutConfig();
  const config = configRes.ok ? configRes.json?.config || {} : {};
  const template = linkRes.ok ? linkRes.json?.template || null : null;
  const tenant = linkRes.ok ? linkRes.json?.tenant || null : null;
  const layout = (template?.layout || {}) as any;
  const title = template?.publicTitle || config?.planTitle || "Paga tu plan";
  const baseDescription = template?.publicDescription || config?.planDescription || "";
  const descriptionLines = ["Pago seguro con Wompi.", baseDescription]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const logoUrl = (() => {
    const candidates = [template?.logoUrl, tenant?.logoUrl, config?.logoUrl];
    for (const candidate of candidates) {
      const raw = String(candidate || "").trim();
      if (raw && raw.toLowerCase() !== "undefined" && raw.toLowerCase() !== "null") return raw;
    }
    return "";
  })();
  const primaryColor = String(layout?.primaryColor || "").trim();
  const fontFamily = String(layout?.fontFamily || "").trim();
  const ctaLabel = String(layout?.ctaLabel || "").trim() || "Pagar";
  const supportEmail = String(config?.supportEmail || "").trim();
  const supportUrl = String(config?.supportUrl || "").trim();
  const layoutSupportEmail = String(layout?.supportEmail || "").trim();
  const layoutSupportUrl = String(layout?.supportUrl || "").trim();
  const supportHref = (layoutSupportEmail ? `mailto:${layoutSupportEmail}` : layoutSupportUrl) || (supportEmail ? `mailto:${supportEmail}` : supportUrl) || "";
  const supportLabel =
    layoutSupportEmail ||
    layoutSupportUrl.replace(/^https?:\/\//, "") ||
    supportEmail ||
    supportUrl.replace(/^https?:\/\//, "") ||
    "";
  const showName = layout?.fields?.showName !== false;
  const showPhone = layout?.fields?.showPhone !== false;
  const showEmail = Boolean(layout?.fields?.showEmail);

  if (!linkRes.ok) {
    const msg = linkRes.status === 410 ? PUBLIC_COPY.errorExpiredLink : PUBLIC_COPY.errorInvalidLink;
    console.info("public_plan_error", {
      status: linkRes.status,
      token,
      message: msg
    });
    return (
      <PublicErrorPage
        title={title}
        message={msg}
        logoUrl={logoUrl}
        trustText={PUBLIC_COPY.trustPayment}
        supportHref={supportHref || undefined}
        supportLabel={supportLabel || undefined}
      />
    );
  }

  const customer = linkRes.json?.customer || {};
  const checkoutUrl = String(linkRes.json?.checkoutUrl || "").trim();

  return (
    <PublicCheckoutLayout
      title={title}
      subtitle=""
      description={descriptionLines}
      logoUrl={logoUrl}
      trustText={PUBLIC_COPY.trustPayment}
      securityBullets={[
        "Pago procesado por Wompi.",
        "Conexi\u00f3n cifrada (HTTPS/TLS).",
        "Tu informaci\u00f3n de tarjeta se maneja en Wompi."
      ]}
      supportHref={supportHref || undefined}
      supportLabel={supportLabel || undefined}
      primaryColor={primaryColor}
      fontFamily={fontFamily}
    >
      {showName ? (
        <div className="field">
          <label>Nombre completo</label>
          <input className="input" readOnly value={customer.name || ""} />
        </div>
      ) : null}
      {showPhone ? (
        <div className="field">
          <label>Teléfono</label>
          <input className="input" readOnly value={customer.phone || ""} />
        </div>
      ) : null}
      {showEmail ? (
        <div className="field">
          <label>Email</label>
          <input className="input" readOnly value={customer.email || ""} />
        </div>
      ) : null}
      {checkoutUrl ? (
        <a className="primary" href={checkoutUrl} referrerPolicy="no-referrer">
          {ctaLabel}
        </a>
      ) : (
        <PublicAlert>{PUBLIC_COPY.errorNoCheckout}</PublicAlert>
      )}
    </PublicCheckoutLayout>
  );
}
