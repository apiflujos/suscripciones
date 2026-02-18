import { PublicCheckoutLayout } from "./PublicCheckoutLayout";

type PublicErrorPageProps = {
  title: string;
  message: string;
  logoUrl?: string;
  trustText?: string;
  supportHref?: string;
  supportLabel?: string;
};

export function PublicErrorPage({
  title,
  message,
  logoUrl,
  trustText,
  supportHref,
  supportLabel
}: PublicErrorPageProps) {
  return (
    <PublicCheckoutLayout
      title={title}
      description={message}
      logoUrl={logoUrl}
      trustText={trustText}
      supportHref={supportHref}
      supportLabel={supportLabel}
      maxWidth={680}
    >
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
