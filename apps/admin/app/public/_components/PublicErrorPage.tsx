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
  return (
    <PublicCheckoutLayout
      title={title}
      description=""
      logoUrl={logoUrl}
      trustText={trustText}
      tenantName={tenantName}
      supportHref={supportHref}
      supportLabel={supportLabel}
      maxWidth={680}
    >
      <PublicAlert>{message}</PublicAlert>
      {supportHref ? (
        <a className="primary" href={supportHref} referrerPolicy="no-referrer" style={{ width: "fit-content" }}>
          Solicitar nuevo link
        </a>
      ) : (
        <div />
      )}
    </PublicCheckoutLayout>
  );
}
