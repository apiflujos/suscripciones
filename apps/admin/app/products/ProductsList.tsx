import Link from "next/link";
import { RowActionsMenu } from "../billing/RowActionsMenu";
import { withReturnTo } from "../lib/returnTo";
import { formatMoneyFromCents } from "./format";
import "./products.css";

export type ProductListItem = {
  id: string;
  sku: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  currency: string;
  basePriceInCents: number;
  tenantName?: string;
  imageUrl?: string | null;
  activeSubscriptions?: number;
  pastDueSubscriptions?: number;
  totalSubscriptions?: number;
};

/**
 * Solo lista. Cada fila tiene un único componente de cliente (el kebab) cuyos
 * ítems son enlaces a las páginas dedicadas; el retorno es la URL actual de la
 * lista, así al volver se conservan búsqueda, filtros y página.
 */
function ProductActions({ product, returnTo }: { product: ProductListItem; returnTo: string }) {
  const base = `/products/${encodeURIComponent(product.id)}`;
  return (
    <RowActionsMenu label={`Acciones de ${product.name}`}>
      <Link className="ghost btn-compact btn-edit btn-noicon" href={withReturnTo(base, returnTo)} data-loader="off">
        Editar
      </Link>
      <Link className="ghost btn-compact btn-create btn-noicon" href={withReturnTo(`${base}/new-subscription`, returnTo)} data-loader="off">
        Crear suscripción
      </Link>
      <Link className="ghost btn-compact btn-send btn-noicon" href={withReturnTo(`${base}/send`, returnTo)} data-loader="off">
        Enviar
      </Link>
      <Link className="ghost btn-compact btn-history btn-noicon" href={withReturnTo(`${base}?tab=transacciones`, returnTo)} data-loader="off">
        Historial de transacciones
      </Link>
      <Link className="ghost btn-compact btn-red btn-noicon" href={withReturnTo(`${base}/delete`, returnTo)} data-loader="off">
        Eliminar
      </Link>
    </RowActionsMenu>
  );
}

export function ProductsList({
  items,
  view,
  returnTo
}: {
  items: ProductListItem[];
  view: "list" | "cards";
  returnTo: string;
}) {
  if (items.length === 0) return <div className="contact-empty">Sin productos/servicios.</div>;

  if (view === "cards") {
    return (
      <div className="product-grid" aria-label="Listado de productos y servicios">
        {items.map((p) => (
          <div key={p.id} className="product-card entity-card">
            <div className="product-img entity-card-media">
              {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <span aria-hidden="true">📦</span>}
            </div>
            <div className="product-body entity-card-body">
              <div className="entity-card-header">
                <div className="products-card-title">
                  <Link className="product-name entity-card-title products-name-link" href={withReturnTo(`/products/${encodeURIComponent(p.id)}`, returnTo)}>
                    {p.name}
                  </Link>
                  <div className="product-meta entity-card-sub">
                    <span className="product-sku">{p.sku || "SKU —"}</span>
                    <span>·</span>
                    <span>{p.kind === "SERVICE" ? "Servicio" : "Producto"}</span>
                  </div>
                </div>
                <div className="entity-card-header-right">
                  <div className="product-price entity-card-price">{formatMoneyFromCents(p.basePriceInCents, p.currency)}</div>
                  <ProductActions product={p} returnTo={returnTo} />
                </div>
              </div>
              <div className="entity-card-grid">
                <div>
                  <div className="field-hint">Canal</div>
                  <div>{p.tenantName || "—"}</div>
                </div>
              </div>
              <div className="entity-card-footer">
                <div className="field-hint">Suscripciones</div>
                <div className="entity-card-counts">
                  <span className="pill pill-sm pill-ok">Act {Number(p.activeSubscriptions || 0)}</span>
                  <span className="pill pill-sm pill-warn">Mora {Number(p.pastDueSubscriptions || 0)}</span>
                  <span className="pill pill-sm pill-muted">Total {Number(p.totalSubscriptions || 0)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="products-list" role="table" aria-label="Listado de productos y servicios">
      <div className="products-list-header" role="row">
        <span role="columnheader">Producto</span>
        <span role="columnheader">Precio</span>
        <span role="columnheader">Suscripciones</span>
        <span role="columnheader">Acciones</span>
      </div>
      {items.map((p) => (
        <div className="products-list-row" role="row" key={p.id}>
          <div className="products-list-cell products-list-main" role="cell">
            <Link className="products-name-link" href={withReturnTo(`/products/${encodeURIComponent(p.id)}`, returnTo)}>
              {p.name}
            </Link>
            <div className="products-list-meta">
              <span>{p.sku || "SKU —"}</span>
              <span aria-hidden="true">·</span>
              <span>{p.kind === "SERVICE" ? "Servicio" : "Producto"}</span>
              {p.tenantName && p.tenantName !== "—" ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{p.tenantName}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="products-list-cell products-list-price" role="cell" data-label="Precio">
            {formatMoneyFromCents(p.basePriceInCents, p.currency)}
          </div>
          <div className="products-list-cell" role="cell" data-label="Suscripciones">
            Activas: {Number(p.activeSubscriptions || 0)}
          </div>
          <div className="products-list-cell products-list-actions" role="cell">
            <ProductActions product={p} returnTo={returnTo} />
          </div>
        </div>
      ))}
    </div>
  );
}
