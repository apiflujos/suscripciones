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
            {logoUrl ? <img src={logoUrl} alt={title} className="publicCheckoutLogo" referrerPolicy="no-referrer" /> : null}
            <h1 style={{ marginTop: 0 }}>{title}</h1>
            {subtitle ? <p style={{ marginTop: 6 }}>{subtitle}</p> : null}
            {description ? <p className="field-hint">{description}</p> : null}
            {trustText ? <p className="field-hint">{trustText}</p> : null}
            {supportHref ? (
              <div className="field-hint">
                ¿Necesitas ayuda?{" "}
                <a href={supportHref} referrerPolicy="no-referrer">
                  {supportLabel || "Contáctanos"}
                </a>
                .
              </div>
            ) : null}
          </div>
          <div className="publicCheckoutSide">{children}</div>
        </div>
      </div>
    </main>
  );
}
