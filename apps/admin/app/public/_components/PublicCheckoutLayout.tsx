import type { CSSProperties, ReactNode } from "react";

type PublicCheckoutLayoutProps = {
  title: string;
  subtitle?: string;
  description?: string | string[];
  logoUrl?: string;
  trustText?: string;
  tenantName?: string;
  brandText?: string;
  securityBullets?: string[];
  supportHref?: string;
  supportLabel?: string;
  maxWidth?: number;
  primaryColor?: string;
  fontFamily?: string;
  variant?: "default" | "single";
  children: ReactNode;
};

export function PublicCheckoutLayout({
  title,
  subtitle,
  description,
  logoUrl,
  trustText,
  tenantName,
  brandText,
  securityBullets,
  supportHref,
  supportLabel,
  maxWidth = 860,
  primaryColor,
  fontFamily,
  variant = "default",
  children
}: PublicCheckoutLayoutProps) {
  const styleVars = primaryColor ? ({ ["--primary" as any]: primaryColor } as CSSProperties) : {};

  const descriptionLines = (Array.isArray(description) ? description : description ? [description] : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const resolvedBrandText =
    brandText ||
    (tenantName ? `Pago para ${tenantName} a través de Apiflujos.` : "Pago gestionado a través de Apiflujos.");

  const layoutClass = `publicCheckoutLayout ${variant === "single" ? "is-single" : ""}`;

  const sideClass = variant === "single" ? "publicCheckoutSide is-single" : "publicCheckoutSide";

  return (
    <main className="page publicCheckoutShell" style={{ maxWidth, ...(fontFamily ? { fontFamily } : {}), ...styleVars }}>
      <div className="card cardPad publicCheckoutCard" style={{ ...(primaryColor ? { borderColor: primaryColor } : {}) }}>
        <div className={layoutClass}>
          <div className="publicCheckoutIntro">
            <div className="publicCheckoutIntroTop">
              <div className="publicCheckoutHeader">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={title}
                    className="publicCheckoutLogo"
                    referrerPolicy="no-referrer"
                    data-theme-logo={logoUrl.startsWith("/brand/") ? "horizontal" : undefined}
                  />
                ) : null}
                <div className="publicCheckoutHeaderText">
                  <h1>{title}</h1>
                </div>
              </div>
            </div>
            <div className="publicCheckoutIntroMeta">
              {subtitle ? <p className="publicCheckoutSubtitle">{subtitle}</p> : null}
              {descriptionLines.length
                ? descriptionLines.map((line, index) => (
                    <p className="publicCheckoutDescription" key={`${line}-${index}`}>
                      {line}
                    </p>
                  ))
                : null}
              <div className="publicCheckoutBrand">
                <span className="publicCheckoutBrandText">{resolvedBrandText}</span>
                <div className="publicCheckoutBrandLogos" aria-label="Apiflujos y Wompi">
                  <img className="publicCheckoutLogoApi" src="/brand/logo_horizontal.svg" alt="Apiflujos" data-theme-logo="horizontal" />
                  <span aria-hidden="true">+</span>
                  <img className="publicCheckoutLogoWompi" src="/brand/wompi-logo.svg" alt="Wompi" />
                </div>
              </div>
              {trustText ? <p className="publicCheckoutTrust">{trustText}</p> : null}
              {securityBullets && securityBullets.length ? (
                <ul className="publicCheckoutSecurity">
                  {securityBullets.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {supportHref ? (
                <div className="publicCheckoutSupport">
                  ¿Necesitas ayuda?{" "}
                  <a href={supportHref} referrerPolicy="no-referrer">
                    {supportLabel || "Contáctanos"}
                  </a>
                  .
                </div>
              ) : null}
            </div>
          </div>
          <div className={sideClass}>{children}</div>
        </div>
      </div>
    </main>
  );
}
