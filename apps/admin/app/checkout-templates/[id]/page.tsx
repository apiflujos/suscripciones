import Link from "next/link";
import { FormActions, PageSection, PageShell } from "../../ui/PageShell";
import { PendingButton } from "../../ui/PendingButton";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { CheckoutTemplateWizard } from "../CheckoutTemplateWizard";
import { deleteCheckoutTemplate, updateCheckoutTemplate } from "../actions";
import { checkoutTemplateErrorMessage } from "../templateErrors";
import { loadTemplateForEdit, loadTemplateFormData } from "../loadTemplateForm";
import "../checkout-templates.css";

export const dynamic = "force-dynamic";

/**
 * Editar plantilla de checkout (antes un modal de 900 px).
 * Con `?confirmDelete=1` muestra la confirmación de borrado en dos pasos, dentro de la página.
 */
export default async function EditCheckoutTemplatePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/checkout-templates");
  const confirmDelete = sp.confirmDelete === "1";
  const error = typeof sp.error === "string" ? sp.error.trim() : "";
  const [{ products, tenants, csrfToken }, template] = await Promise.all([loadTemplateFormData(), loadTemplateForEdit(id)]);
  const selfHref = withReturnTo(`/checkout-templates/${encodeURIComponent(id)}`, returnTo);
  const deleteHref = withReturnTo(`/checkout-templates/${encodeURIComponent(id)}?confirmDelete=1`, returnTo);

  if (confirmDelete) {
    return (
      <PageShell
        title="Eliminar plantilla"
        subtitle={template.name}
        crumbs={[{ label: "Plantillas de checkout", href: returnTo }, { label: template.name, href: selfHref }, { label: "Eliminar" }]}
        backHref={selfHref}
        notice={error ? { tone: "error", text: checkoutTemplateErrorMessage(error) } : null}
      >
        <form action={deleteCheckoutTemplate} className="page-shell-body">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="id" value={template.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="errorTo" value={deleteHref} />
          <PageSection title="¿Eliminar esta plantilla?" description="Esta acción no se puede deshacer.">
            <p style={{ margin: 0 }}>
              Se eliminará la plantilla <strong>{template.name}</strong>. Los links de checkout que ya se enviaron con ella dejarán de funcionar
              con esta configuración.
            </p>
          </PageSection>
          <FormActions cancelHref={selfHref} cancelLabel="No, conservar">
            <PendingButton className="primary btn-compact btn-red" type="submit" pendingText="Eliminando...">
              Sí, eliminar plantilla
            </PendingButton>
          </FormActions>
        </form>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Editar plantilla"
      subtitle={template.name}
      crumbs={[{ label: "Plantillas de checkout", href: returnTo }, { label: template.name }]}
      backHref={returnTo}
      width="wide"
      headerActions={
        <Link className="ghost btn-compact btn-red" href={deleteHref} data-loader="off">
          Eliminar…
        </Link>
      }
      notice={error ? { tone: "error", text: checkoutTemplateErrorMessage(error) } : null}
    >
      <CheckoutTemplateWizard
        template={template}
        products={products}
        tenants={tenants}
        csrfToken={csrfToken}
        returnTo={returnTo}
        errorTo={selfHref}
        action={updateCheckoutTemplate}
      />
    </PageShell>
  );
}
