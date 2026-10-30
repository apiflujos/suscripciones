import Link from "next/link";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { PendingButton } from "../../../ui/PendingButton";
import { resolveReturnTo, withReturnTo } from "../../../lib/returnTo";
import { deleteProduct } from "../../actions";
import { formatMoneyFromCents, productErrorMessage } from "../../format";
import { loadProduct } from "../../loadProduct";

export const dynamic = "force-dynamic";

/**
 * Eliminar un producto en dos pasos dentro de la página (sin capa encima):
 * 1) se explica qué se borra; 2) "¿Seguro?" con el botón que confirma.
 */
export default async function DeleteProductPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/products");
  const confirming = sp.confirm === "1";
  const error = productErrorMessage(sp.error);
  const { item, csrfToken } = await loadProduct(id);
  const base = `/products/${encodeURIComponent(item.id)}/delete`;

  return (
    <PageShell
      title="Eliminar producto"
      subtitle={`${item.name} · ${item.sku || "SKU —"} · ${formatMoneyFromCents(item.basePriceInCents, item.currency)}`}
      crumbs={[{ label: "Productos", href: returnTo }, { label: item.name }, { label: "Eliminar" }]}
      backHref={returnTo}
      notice={error ? { tone: "error", text: error } : null}
    >
      {!confirming ? (
        <>
          <PageSection title="Paso 1 de 2 · Revisa qué vas a eliminar">
            <p className="product-delete-text">
              Vas a eliminar <strong>{item.name}</strong> del catálogo. Si tiene suscripciones activas, en mora o suspendidas, o links asociados, el sistema no
              permitirá borrarlo hasta que las canceles.
            </p>
          </PageSection>
          <FormActions cancelHref={returnTo}>
            <Link className="primary btn-compact btn-red btn-noicon" href={withReturnTo(`${base}?confirm=1`, returnTo)} data-loader="off">
              Continuar
            </Link>
          </FormActions>
        </>
      ) : (
        <form action={deleteProduct} className="page-shell-body">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="tenantId" value={item.tenantId || ""} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="failTo" value={withReturnTo(base, returnTo)} />
          <PageSection title="Paso 2 de 2 · ¿Seguro?">
            <div className="field-hint ui-alert-danger" role="alert">
              ¿Eliminar este producto? Esta acción no se puede deshacer.
            </div>
          </PageSection>
          <FormActions cancelHref={returnTo}>
            <PendingButton className="primary btn-compact btn-red btn-noicon" type="submit" pendingText="Eliminando...">
              Sí, eliminar producto
            </PendingButton>
          </FormActions>
        </form>
      )}
    </PageShell>
  );
}
