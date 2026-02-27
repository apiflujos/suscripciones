import type { CSSProperties, ReactNode } from "react";

type PublicCheckoutLayoutProps = {
  title: string;
  subtitle?: string;
  description?: string;
  logoUrl?: string;
  trustText?: string;
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
  supportHref,
  supportLabel,
  maxWidth = 860,
  primaryColor,
  fontFamily,
  children
}: PublicCheckoutLayoutProps) {
  const styleVars = primaryColor ? ({ ["--primary" as any]: primaryColor } as CSSProperties) : {};

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
                  {subtitle ? <p className="publicCheckoutSubtitle">{subtitle}</p> : null}
                </div>
              </div>
            </div>
            <div className="publicCheckoutIntroMeta">
              {description ? <p className="publicCheckoutDescription">{description}</p> : null}
              {trustText ? <p className="publicCheckoutTrust">{trustText}</p> : null}
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
