import Link from "next/link";
import { withReturnTo } from "../lib/returnTo";
import { RowActionsMenu } from "./RowActionsMenu";
import { BillingRowMenuItems } from "./BillingRowMenuItems";
import { fmtMoney, getCollectionStatusLabel } from "./billingDisplayHelpers";
import { formatCivilDate } from "./civilDate";
import type { BillingCardContext, BillingRow } from "./billingTypes";

type BillingViewKanbanProps = {
  rows: BillingRow[];
  context: BillingCardContext;
};

export function BillingViewKanban({ rows, context }: BillingViewKanbanProps) {
  const columns = ["Al día", "En gracia", "En mora"];
  const grouped = new Map<string, BillingRow[]>();
  for (const column of columns) grouped.set(column, []);
  for (const row of rows) {
    const paymentStatus = getCollectionStatusLabel({
      status: row.status,
      dueAt: row.vencimientoAt,
      graceDays: row.graceDays,
      collectionCyclePaid: row.collectionCyclePaid
    });
    const key = paymentStatus === "En mora" ? "En mora" : paymentStatus === "En gracia" ? "En gracia" : "Al día";
    grouped.get(key)?.push(row);
  }

  return (
    <div className="billing-kanban">
      {columns.map((column, index) => (
        <div className="billing-kanban-column" data-idx={index + 1} key={`kanban-${column}`}>
          <div className="billing-kanban-title">
            <span>{column}</span>
            <span className="pill pill-sm pill-muted">{grouped.get(column)?.length || 0}</span>
          </div>
          <div className="billing-kanban-list">
            {(grouped.get(column) || []).map((row) => {
              const isAutoDebit = row.mode === "AUTO_DEBIT";
              const isCanceled = row.status === "CANCELED";
              const isSuspended = row.status === "SUSPENDED";
              const isExpired = row.status === "EXPIRED";
              const isReactivatable = isCanceled || isExpired;
              const isInactive = isReactivatable || isSuspended;
              const alreadyPaidCurrentPeriod = Boolean(row.lastPaidInCurrentPeriod);
              const showManualCharge = isAutoDebit && !isInactive && Boolean(row.canManualCharge);
              const showMarkPaid = !isInactive && !alreadyPaidCurrentPeriod && Boolean(row.canManualMarkPaid);
              const itemPaymentStatus = getCollectionStatusLabel({
                status: row.status,
                dueAt: row.vencimientoAt,
                graceDays: row.graceDays,
                collectionCyclePaid: row.collectionCyclePaid
              });
              return (
                <div key={`kanban-item-${row.id}`} className="billing-kanban-card">
                  <Link className="billing-kanban-card-button" href={withReturnTo(`/billing/${encodeURIComponent(row.id)}`, context.data.returnTo)}>
                    <div
                      className="billing-kanban-summary"
                      title={`Suscripción: ${row.estadoInfo.label}`}
                    >
                      <div className="billing-kanban-name">{row.customerName}</div>
                      <div className="billing-kanban-sub">{row.productName || row.planName || "—"}</div>
                      <div className="billing-kanban-meta">
                        <span>{fmtMoney(row.totalInCents ?? row.montoInCents, row.moneda)}</span>
                        <span>·</span>
                        <span>{formatCivilDate(row.vencimientoAt)}</span>
                      </div>
                      <div className="billing-kanban-sub">{row.tipoTx} · {row.cada}</div>
                      <div className="billing-kanban-badges">
                        <span className={`pill pill-sm ${itemPaymentStatus === "Al día" ? "pill-ok" : itemPaymentStatus === "En mora" ? "pill-bad" : "pill-warn"}`}>
                          {itemPaymentStatus}
                        </span>
                      </div>
                    </div>
                  </Link>
                  <div className="billing-kanban-card-actions">
                    <RowActionsMenu label="Acciones de la suscripción">
                <BillingRowMenuItems row={row} context={context} />
              </RowActionsMenu>
                  </div>
                </div>
              );
            })}
            {(grouped.get(column) || []).length === 0 ? <div className="billing-kanban-empty">Sin registros</div> : null}
          </div>
        </div>
      ))}
      {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
    </div>
  );
}

