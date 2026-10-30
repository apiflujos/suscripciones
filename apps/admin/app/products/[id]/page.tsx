import Link from "next/link";
import { PageSection, PageShell } from "../../ui/PageShell";
import { LocalDateTime } from "../../ui/LocalDateTime";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { getProductPayments } from "../../admin/_services/payments";
import { updateProduct } from "../actions";
import { ProductForm } from "../ProductForm";
import { formatMoneyFromCents, productErrorMessage } from "../format";
import { listActiveTenants, loadProduct } from "../loadProduct";
import "../products.css";

export const dynamic = "force-dynamic";

/**
 * Editar un producto/servicio y ver sus transacciones. Reemplaza los modales
 * "Editar" y "Transacciones: <producto>" de la lista.
 */
export default async function ProductPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/products");
  const tab = sp.tab === "transacciones" ? "transacciones" : "datos";
  const error = productErrorMessage(sp.error);
  const { item, csrfToken, scopeTenantId } = await loadProduct(id);
  const tenants = await listActiveTenants();

  const base = `/products/${encodeURIComponent(item.id)}`;
  const selfHref = withReturnTo(base, returnTo);
  const txHref = withReturnTo(`${base}?tab=transacciones`, returnTo);

  const tx = tab === "transacciones" ? await getProductPayments({ productId: item.id, tenantId: scopeTenantId, take: 50, skip: 0 }) : null;
  const txItems = tx && tx.ok && "items" in tx ? ((tx.items ?? []) as any[]) : [];
  const txError = tx && !tx.ok ? String((tx as any).error || "request_failed") : "";

  return (
    <PageShell
      title={`Editar: ${item.name}`}
      subtitle={`${item.kind === "SERVICE" ? "Servicio" : "Producto"} · ${item.sku || "SKU —"} · ${formatMoneyFromCents(item.basePriceInCents, item.currency)}`}
      crumbs={[{ label: "Productos", href: returnTo }, { label: item.name }]}
      backHref={returnTo}
      width="wide"
      notice={error ? { tone: "error", text: error } : null}
      headerActions={
        <>
          <Link className="ghost btn-compact btn-create btn-noicon" href={withReturnTo(`${base}/new-subscription`, returnTo)}>
            Crear suscripción
          </Link>
          <Link className="ghost btn-compact btn-send btn-noicon" href={withReturnTo(`${base}/send`, returnTo)}>
            Enviar
          </Link>
          <Link className="ghost btn-compact btn-red btn-noicon" href={withReturnTo(`${base}/delete`, returnTo)}>
            Eliminar
          </Link>
        </>
      }
    >
      <nav className="page-shell-tabs" aria-label="Secciones del producto">
        <Link className={`page-shell-tab${tab === "datos" ? " is-active" : ""}`} href={selfHref} aria-current={tab === "datos" ? "page" : undefined} data-loader="off">
          Datos
        </Link>
        <Link className={`page-shell-tab${tab === "transacciones" ? " is-active" : ""}`} href={txHref} aria-current={tab === "transacciones" ? "page" : undefined} data-loader="off">
          Transacciones
        </Link>
      </nav>

      {tab === "datos" ? (
        <ProductForm
          action={updateProduct}
          csrfToken={csrfToken}
          tenants={tenants}
          returnTo={returnTo}
          failTo={selfHref}
          product={item}
        />
      ) : (
        <PageSection title={`Transacciones: ${item.name}`} description="Pagos de las suscripciones de este producto. Se muestran los 50 más recientes.">
          {txError ? (
            <div className="field-hint ui-alert-danger" role="alert">Error: {txError}</div>
          ) : txItems.length === 0 ? (
            <div className="field-hint">No hay transacciones.</div>
          ) : (
            <table className="page-shell-table tx-table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Monto</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Contacto</th>
                  <th scope="col">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {txItems.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Fecha"><LocalDateTime value={t.createdAt} /></td>
                    <td data-label="Monto">{formatMoneyFromCents(t.amountInCents, String(t.currency || item.currency || "COP"))}</td>
                    <td data-label="Estado">{t.status || "—"}</td>
                    <td data-label="Contacto">{t.customerName || "—"}</td>
                    <td data-label="Referencia" className="mono">{t.reference || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PageSection>
      )}
    </PageShell>
  );
}
