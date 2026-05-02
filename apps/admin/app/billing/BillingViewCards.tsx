import type { ReactNode } from "react";
import type { BillingRow } from "./billingTypes";

type BillingViewCardsProps = {
  rows: BillingRow[];
  renderCard: (row: BillingRow) => ReactNode;
};

export function BillingViewCards({ rows, renderCard }: BillingViewCardsProps) {
  return (
    <div className="billing-grid">
      {rows.map((row) => (
        <div key={row.id}>{renderCard(row)}</div>
      ))}
      {rows.length === 0 ? <div className="contact-empty">Sin resultados.</div> : null}
    </div>
  );
}
