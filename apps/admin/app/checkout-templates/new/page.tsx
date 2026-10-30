import { PageShell } from "../../ui/PageShell";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { CheckoutTemplateWizard } from "../CheckoutTemplateWizard";
import { createCheckoutTemplate } from "../actions";
import { checkoutTemplateErrorMessage } from "../templateErrors";
import { loadTemplateFormData } from "../loadTemplateForm";
import "../checkout-templates.css";

export const dynamic = "force-dynamic";

/** Nueva plantilla de checkout. Era el asistente en un modal de 900 px. */
export default async function NewCheckoutTemplatePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/checkout-templates");
  const kindRaw = typeof sp.kind === "string" ? sp.kind.toUpperCase() : "";
  const initialKind = kindRaw === "PLAN" || kindRaw === "SUBSCRIPTION" || kindRaw === "CART" ? kindRaw : "";
  const error = typeof sp.error === "string" ? sp.error.trim() : "";
  const { products, tenants, csrfToken } = await loadTemplateFormData();

  return (
    <PageShell
      title="Nueva plantilla"
      subtitle="Define el tipo, el contenido, la marca y el producto del checkout público."
      crumbs={[{ label: "Plantillas de checkout", href: returnTo }, { label: "Nueva plantilla" }]}
      backHref={returnTo}
      width="wide"
      notice={error ? { tone: "error", text: checkoutTemplateErrorMessage(error) } : null}
    >
      <CheckoutTemplateWizard
        template={null}
        products={products}
        tenants={tenants}
        csrfToken={csrfToken}
        returnTo={returnTo}
        errorTo={withReturnTo("/checkout-templates/new", returnTo)}
        action={createCheckoutTemplate}
        initialKind={initialKind}
      />
    </PageShell>
  );
}
