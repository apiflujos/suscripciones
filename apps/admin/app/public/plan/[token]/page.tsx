import { PublicCheckoutLayout } from "../../_components/PublicCheckoutLayout";
import { PublicAlert } from "../../_components/PublicAlert";
import { PublicErrorPage } from "../../_components/PublicErrorPage";
import { PUBLIC_COPY } from "../../_components/publicCopy";
import { fetchPublicJsonAcrossBases, getPublicApiBases } from "../../_components/publicRuntime";
import { logger } from "@suscripciones/core/lib/logger";

export const dynamic = "force-dynamic";

export default async function PublicPlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const apiBases = await getPublicApiBases();
  const linkRes = await fetchPublicJsonAcrossBases(`/public/payment-links/${encodeURIComponent(token)}`, apiBases);
  const configRes = await fetchPublicJsonAcrossBases("/public/checkout-config", apiBases);
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
    logger.info({ status: linkRes.status, token, message: msg }, "public_plan_error");
    return (
      <PublicErrorPage
        title={title}
        message={msg}
        logoUrl={logoUrl}
        trustText={PUBLIC_COPY.trustPayment}
        tenantName={tenant?.name || ""}
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
      tenantName={tenant?.name || ""}
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
      <div className="payment-point">
        <div className="payment-point-title">Punto de pago</div>
        <div className="payment-point-provider">
          <img src="/brand/wompi-icon.svg" alt="" />
          Procesado por Wompi
        </div>
        {checkoutUrl ? (
          <a className="primary btn-compact btn-pay" href={checkoutUrl} referrerPolicy="no-referrer">
            {ctaLabel}
          </a>
        ) : (
          <PublicAlert>{PUBLIC_COPY.errorNoCheckout}</PublicAlert>
        )}
      </div>
    </PublicCheckoutLayout>
  );
}
