import { getAdminSettings } from "../../admin/_services/settings";
import { PageShell } from "../../ui/PageShell";
import { getCsrfToken } from "../../lib/csrf";
import { resolveReturnTo } from "../../lib/returnTo";
import { updateCheckoutConfig } from "../actions";
import { RedirectConfigForm } from "../RedirectConfigForm";

export const dynamic = "force-dynamic";

const LIST_HREF = "/settings?tab=checkout-publico";

/** Editar redirecciones y mensajes del checkout público (antes, modal de 900 px). */
export default async function RedirectsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  let returnTo = resolveReturnTo(sp.returnTo, LIST_HREF);
  if (!returnTo.startsWith("/settings")) returnTo = LIST_HREF;
  const [csrfToken, settings] = await Promise.all([getCsrfToken(), getAdminSettings()]);
  const appPublicBaseUrl = String(process.env.APP_PUBLIC_BASE_URL || "").trim();

  return (
    <PageShell
      title="Editar redirecciones y mensajes"
      subtitle="URLs públicas y mensajes que aparecen en Wompi."
      crumbs={[{ label: "Ajustes", href: "/settings" }, { label: "Checkout público", href: returnTo }, { label: "Redirecciones y mensajes" }]}
      backHref={returnTo}
    >
      <RedirectConfigForm
        defaults={((settings as any)?.checkoutConfig || {}) as any}
        appPublicBaseUrl={appPublicBaseUrl}
        csrfToken={csrfToken}
        returnTo={returnTo}
        cancelHref={returnTo}
        onSave={updateCheckoutConfig}
      />
    </PageShell>
  );
}
