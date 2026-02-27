import type { CSSProperties, ReactNode } from "react";

type PublicCheckoutLayoutProps = {
  title: string;
  subtitle?: string;
  description?: string | string[];
  logoUrl?: string;
  trustText?: string;
  securityBullets?: string[];
  supportHref?: string;
  supportLabel?: string;
  maxWidth?: number;
  primaryColor?: string;
  fontFamily?: string;
  children: ReactNode;
};

export function PublicCheckoutLayout({
  title,
  subtitle,
  description,
  logoUrl,
  trustText,
  securityBullets,
  supportHref,
  supportLabel,
  maxWidth = 860,
  primaryColor,
  fontFamily,
  children
}: PublicCheckoutLayoutProps) {
  const styleVars = primaryColor ? ({ ["--primary" as any]: primaryColor } as CSSProperties) : {};

  const descriptionLines = (Array.isArray(description) ? description : description ? [description] : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return (
    <main className="page publicCheckoutShell" style={{ maxWidth, ...(fontFamily ? { fontFamily } : {}), ...styleVars }}>
      <div className="card cardPad publicCheckoutCard" style={{ ...(primaryColor ? { borderColor: primaryColor } : {}) }}>
        <div className="publicCheckoutLayout">
          <div className="publicCheckoutIntro">
            <div className="publicCheckoutIntroTop">
              <div className="publicCheckoutHeader">
                {logoUrl ? <img src={logoUrl} alt={title} className="publicCheckoutLogo" referrerPolicy="no-referrer" /> : null}
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
          <div className="publicCheckoutSide">{children}</div>
        </div>
      </div>
    </main>
  );
}
