import { PublicCheckoutLayout } from "./PublicCheckoutLayout";
import { PublicAlert } from "./PublicAlert";

type PublicErrorPageProps = {
  title: string;
  message: string;
  logoUrl?: string;
  trustText?: string;
  tenantName?: string;
  supportHref?: string;
  supportLabel?: string;
};

export function PublicErrorPage({
  title,
  message,
  logoUrl,
  trustText,
  tenantName,
  supportHref,
  supportLabel
}: PublicErrorPageProps) {
  const resolvedLogo = String(logoUrl || "").trim() || "/brand/logo_horizontal.svg";
  return (
    <PublicCheckoutLayout
      title={title}
      description={trustText || "Pago seguro con Wompi."}
      logoUrl={resolvedLogo}
      trustText={trustText}
      tenantName={tenantName}
      supportHref={supportHref}
      supportLabel={supportLabel}
      maxWidth={720}
      variant="single"
    >
      <div className="publicErrorStack">
        <PublicAlert>{message}</PublicAlert>
        {supportHref ? (
          <a className="primary btn-compact btn-noicon" href={supportHref} referrerPolicy="no-referrer" style={{ width: "fit-content" }}>
            Solicitar nuevo link
          </a>
        ) : null}
      </div>
    </PublicCheckoutLayout>
  );
}
