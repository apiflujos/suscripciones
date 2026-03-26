"use client";

import { useEffect, useState } from "react";
import { LocalDateTime } from "../ui/LocalDateTime";

type BillingCycleItem = {
  id: string;
  cycleNumber: number;
  periodStartAt: string;
  periodEndAt: string;
  dueAt: string;
  paidAt?: string | null;
  paidOnTime?: boolean | null;
  daysEarly?: number | null;
  daysLate?: number | null;
  origin?: string | null;
  subscription?: { plan?: { name?: string | null } | null } | null;
};

type Props = {
  subscriptionId: string;
};

function originLabel(origin?: string | null) {
  const s = String(origin || "").toUpperCase();
  if (s === "AUTO_DEBIT") return "Auto débito";
  if (s === "AUTO_LINK") return "Auto link";
  if (s === "MANUAL_LINK") return "Link manual";
  if (s === "MANUAL_USER") return "Manual (usuario)";
  if (s === "WEBHOOK") return "Webhook";
  return s || "—";
}

export function BillingCyclesButton({ subscriptionId }: Props) {
  const [open, setOpen] = useState(false);
  const [cycles, setCycles] = useState<BillingCycleItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    fetch(`/api/billing/billing-cycles?subscriptionId=${encodeURIComponent(subscriptionId)}&take=24`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!active) return;
        if (!ok) {
          setCycles([]);
          return;
        }
        setCycles(Array.isArray(json?.items) ? json.items : []);
      })
      .catch(() => {
        if (!active) return;
        setCycles([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, subscriptionId]);

  return (
    <>
      <button
        type="button"
        className="ghost btn-compact btn-icon-only btn-calendar"
        aria-label="Ciclos de pago"
        title="Ciclos de pago"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true" />
      </button>
      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(760px, 96vw)" }}>
            <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Ciclos de pago</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <div className="billing-history">
              {loading ? <div className="muted">Cargando ciclos...</div> : null}
              {!loading && cycles.length === 0 ? <div className="muted">Sin ciclos registrados.</div> : null}
              {!loading && cycles.length > 0 ? (
                <div className="billing-history-table-wrap">
                  <table className="table billing-history-table" aria-label="Ciclos de pago">
                    <thead>
                      <tr>
                        <th>Ciclo</th>
                        <th>Periodo</th>
                        <th>Vence</th>
                        <th>Pago</th>
                        <th>Puntualidad</th>
                        <th>Origen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycles.map((c) => {
                        const punctual =
                          c.paidOnTime == null
                            ? "—"
                            : c.paidOnTime
                              ? c.daysEarly && c.daysEarly > 0
                                ? `Temprano (${c.daysEarly}d)`
                                : "A tiempo"
                              : c.daysLate && c.daysLate > 0
                                ? `Tarde (${c.daysLate}d)`
                                : "Tarde";
                        return (
                          <tr key={c.id}>
                            <td>Ciclo {c.cycleNumber}</td>
                            <td>
                              <LocalDateTime value={c.periodStartAt} variant="short" /> ·{" "}
                              <LocalDateTime value={c.periodEndAt} variant="short" />
                            </td>
                            <td><LocalDateTime value={c.dueAt} variant="short" /></td>
                            <td>{c.paidAt ? <LocalDateTime value={c.paidAt} variant="short" /> : "—"}</td>
                            <td>{punctual}</td>
                            <td>{originLabel(c.origin)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
