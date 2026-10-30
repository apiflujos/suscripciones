import Link from "next/link";
import { withReturnTo } from "../lib/returnTo";
import type { BillingCardContext, BillingRow } from "./billingTypes";

/**
 * Ítems del kebab de una fila (lista, tarjetas y kanban). Cada acción con contenido
 * es un enlace a su página dedicada, con `returnTo` hacia la lista actual; solo
 * "Reanudar" y "Reactivar", que no piden nada, siguen siendo formularios de un clic.
 *
 * Antes cada ítem montaba su propio modal dentro de la fila (ocho por fila).
 */
export function BillingRowMenuItems({ row, context }: { row: BillingRow; context: BillingCardContext }) {
  const returnTo = context.data.returnTo;
  const go = (path = "") => withReturnTo(`/billing/${encodeURIComponent(row.id)}${path}`, returnTo);

  const isAutoDebit = row.mode === "AUTO_DEBIT";
  const isSuspended = row.status === "SUSPENDED";
  const isReactivatable = row.status === "CANCELED" || row.status === "EXPIRED";
  const isInactive = isSuspended || isReactivatable;
  const alreadyPaid = Boolean(row.lastPaidInCurrentPeriod);

  const showCharge = isAutoDebit && !isInactive && Boolean(row.canManualCharge);
  const showMarkPaid = !isInactive && !alreadyPaid && Boolean(row.canManualMarkPaid);
  const showUnmark = Boolean(row.canManualUnmarkPaid);

  // Duplicados: solo en la que queda como "principal" del grupo, para que el
  // `keepSubscriptionId` coincida con la fila desde la que se fusiona.
  const duplicateKey = context.helpers.resolveDuplicateKey(row);
  const duplicateCount = context.helpers.duplicateCountByKey.get(duplicateKey) || 1;
  const isDuplicateKeep = context.helpers.duplicateKeepByKey.get(duplicateKey)?.id === row.id;

  return (
    <>
      <Link className="ghost btn-compact btn-noicon" href={go()} role="menuitem">Ver detalle</Link>
      <Link className="ghost btn-compact btn-noicon" href={go("/change-product")} role="menuitem">Cambiar producto</Link>
      <Link className="ghost btn-compact btn-noicon" href={`${go()}${go().includes("?") ? "&" : "?"}tab=pagos`} role="menuitem">Historial de pagos</Link>
      {showCharge ? <Link className="ghost btn-compact btn-noicon" href={go("/charge")} role="menuitem">Cobrar</Link> : null}
      {showMarkPaid ? <Link className="ghost btn-compact btn-noicon" href={go("/mark-paid")} role="menuitem">Marcar pagada</Link> : null}
      {showUnmark ? <Link className="ghost btn-compact btn-noicon" href={go("/unmark-paid")} role="menuitem">Desmarcar cobro</Link> : null}
      {!isInactive && !isAutoDebit ? <Link className="ghost btn-compact btn-noicon" href={go("/payment-link")} role="menuitem">Enviar link de pago</Link> : null}
      {isAutoDebit && !isInactive ? <Link className="ghost btn-compact btn-noicon" href={go("/tokenization")} role="menuitem">Enviar tokenización</Link> : null}
      {isSuspended ? (
        <form action={context.actions.resumeSubscription}>
          <input type="hidden" name="csrf" value={context.data.csrfToken} />
          <input type="hidden" name="subscriptionId" value={row.id} />
          {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="ghost btn-compact btn-green btn-noicon" type="submit" title="Reanudar suscripción">Reanudar</button>
        </form>
      ) : null}
      {isReactivatable ? (
        <form action={context.actions.activateSubscription}>
          <input type="hidden" name="csrf" value={context.data.csrfToken} />
          <input type="hidden" name="subscriptionId" value={row.id} />
          {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="ghost btn-compact btn-green btn-noicon" type="submit" title="Reactivar suscripción">Reactivar</button>
        </form>
      ) : null}
      {isDuplicateKeep && duplicateCount > 1 ? (
        <Link className="ghost btn-compact btn-amber btn-noicon" href={go("/merge")} role="menuitem">Fusionar duplicadas ({duplicateCount - 1})</Link>
      ) : null}
      <Link className="ghost btn-compact btn-red btn-noicon" href={go("/delete")} role="menuitem">Eliminar</Link>
    </>
  );
}
