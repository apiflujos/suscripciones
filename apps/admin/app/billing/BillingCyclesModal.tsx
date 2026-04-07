"use client";

import { useEffect, useState, Fragment } from "react";
import { AppModal } from "../ui/AppModal";
import { LocalDateTime } from "../ui/LocalDateTime";
import { movePaymentToCycle } from "./actions";

type BillingCycleItem = {
  id: string;
  subscriptionId: string;
  cycleNumber: number;
  periodStartAt: string;
  periodEndAt: string;
  dueAt: string;
  status: "PENDING" | "PAID" | "FAILED" | "SKIPPED";
  paidAt?: string | null;
  paymentId?: string | null;
  paidOnTime?: boolean | null;
  daysEarly?: number | null;
  daysLate?: number | null;
  origin?: string | null;
  associationReason?: string | null;
  subscription?: {
    id?: string;
    plan?: { name?: string | null; id?: string } | null;
  } | null;
};

type Props = {
  subscriptionId: string;
  csrfToken: string;
  returnTo: string;
  tenantId?: string | null;
  trigger?: (onOpen: () => void) => React.ReactNode;
  forceOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function originLabel(origin?: string | null) {
  const s = String(origin || "").toUpperCase();
  if (s === "AUTO_DEBIT") return { label: "Auto débito", class: "pill-muted" };
  if (s === "AUTO_LINK") return { label: "Auto link", class: "pill-muted" };
  if (s === "MANUAL_LINK") return { label: "Link manual", class: "pill-muted" };
  if (s === "MANUAL_USER") return { label: "Manual", class: "pill-muted" };
  if (s === "WEBHOOK") return { label: "Webhook", class: "pill-muted" };
  return { label: s || "—", class: "pill-muted" };
}

function statusLabel(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "PAID") return { label: "Pagado", class: "pill-ok" };
  if (s === "PENDING") return { label: "Pendiente", class: "pill-warn" };
  if (s === "FAILED") return { label: "Fallido", class: "pill-bad" };
  if (s === "SKIPPED") return { label: "Saltado", class: "pill-muted" };
  return { label: s || "—", class: "pill-muted" };
}

function punctualityLabel(cycle: BillingCycleItem) {
  if (cycle.paidOnTime == null) return { label: "—", class: "pill-muted" };
  if (cycle.paidOnTime) {
    if (cycle.daysEarly && cycle.daysEarly > 0) return { label: `Temprano (${cycle.daysEarly}d)`, class: "pill-ok" };
    return { label: "A tiempo", class: "pill-ok" };
  }
  if (cycle.daysLate && cycle.daysLate > 0) return { label: `Tarde (${cycle.daysLate}d)`, class: "pill-bad" };
  return { label: "Tarde", class: "pill-bad" };
}

function formatDateRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();
  
  if (sameMonth) {
    return (
      <span>
        <LocalDateTime value={start} variant="short" /> ·{" "}
        <LocalDateTime value={end} variant="short" />
      </span>
    );
  }
  
  return (
    <span>
      <LocalDateTime value={start} variant="short" /> ·{" "}
      <LocalDateTime value={end} variant="short" />
    </span>
  );
}

export function BillingCyclesModal({ subscriptionId, csrfToken, returnTo, tenantId, trigger, forceOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<BillingCycleItem[]>([]);
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);
  const open = forceOpen ?? internalOpen;

  const setOpen = (next: boolean) => {
    if (forceOpen === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    fetch(`/api/billing/billing-cycles?subscriptionId=${encodeURIComponent(subscriptionId)}&take=36`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!active) return;
        if (!ok) {
          setItems([]);
          return;
        }
        setItems(Array.isArray(json?.items) ? json.items : []);
      })
      .catch(() => {
        if (!active) return;
        setItems([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, subscriptionId]);

  const handleOpen = () => setOpen(true);
  
  const triggerButton = forceOpen !== undefined
    ? null
    : trigger ? (
        trigger(handleOpen)
      ) : (
        <button
          className="ghost btn-compact btn-icon-only btn-calendar"
          type="button"
          title="Ver ciclos de pago"
          aria-label="Ver ciclos de pago"
          onClick={handleOpen}
        >
          <span aria-hidden="true" />
        </button>
      );

  return (
    <>
      {triggerButton}

      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        title={
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span>Ciclos de Pago</span>
            <span className="pill pill-sm pill-muted">{items.length} ciclos</span>
          </div>
        }
        width="min(900px, 96vw)"
        panelClassName="modal-panel-fixed"
      >
        <div style={{ padding: "8px 0" }}>
              {loading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--text-faint)" }}>
                  <div className="loading-spinner" style={{ margin: "0 auto 12px" }} />
                  Cargando ciclos...
                </div>
              ) : items.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--text-faint)" }}>
                  <div style={{ fontSize: "48px", marginBottom: "12px", opacity: 0.3 }}>📅</div>
                  <div style={{ fontWeight: 600, marginBottom: "4px" }}>Sin ciclos registrados</div>
                  <div style={{ fontSize: "13px" }}>Esta suscripción aún no tiene ciclos de pago.</div>
                </div>
              ) : (
                <div className="billing-history-table-wrap" style={{ maxHeight: "60vh" }}>
                  <table className="table billing-history-table" aria-label="Ciclos de pago">
                    <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                      <tr>
                        <th style={{ width: "70px", textAlign: "left" }}>Ciclo</th>
                        <th style={{ width: "220px", textAlign: "left" }}>Período</th>
                        <th style={{ width: "130px", textAlign: "left" }}>Vence</th>
                        <th style={{ width: "130px", textAlign: "left" }}>Pago</th>
                        <th style={{ width: "110px", textAlign: "left" }}>Estado</th>
                        <th style={{ width: "140px", textAlign: "left" }}>Puntualidad</th>
                        <th style={{ width: "110px", textAlign: "left" }}>Origen</th>
                        <th style={{ width: "40px", textAlign: "center" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((cycle) => {
                        const status = statusLabel(cycle.status);
                        const punctual = punctualityLabel(cycle);
                        const origin = originLabel(cycle.origin);
                        const isExpanded = expandedCycle === cycle.id;

                        return (
                          <Fragment key={cycle.id}>
                            <tr
                              style={{ cursor: "pointer" }}
                              onClick={() => setExpandedCycle(isExpanded ? null : cycle.id)}
                            >
                              <td style={{ textAlign: "left" }}>
                                <strong style={{ fontSize: "13px" }}>Ciclo {cycle.cycleNumber}</strong>
                              </td>
                              <td style={{ textAlign: "left" }}>{formatDateRange(cycle.periodStartAt, cycle.periodEndAt)}</td>
                              <td style={{ textAlign: "left" }}><LocalDateTime value={cycle.dueAt} variant="short" /></td>
                              <td style={{ textAlign: "left" }}>{cycle.paidAt ? <LocalDateTime value={cycle.paidAt} variant="short" /> : "—"}</td>
                              <td style={{ textAlign: "left" }}><span className={`pill pill-sm ${status.class}`}>{status.label}</span></td>
                              <td style={{ textAlign: "left" }}><span className={`pill pill-sm ${punctual.class}`}>{punctual.label}</span></td>
                              <td style={{ textAlign: "left" }}><span className={`pill pill-sm ${origin.class}`}>{origin.label}</span></td>
                              <td style={{ textAlign: "center" }}>
                                <span
                                  className={`btn-icon-only ${isExpanded ? "active" : ""}`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "24px",
                                    height: "24px",
                                    fontSize: "10px",
                                    transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                    transition: "transform 0.2s"
                                  }}
                                >
                                  ▼
                                </span>
                              </td>
                            </tr>
                            
                            {isExpanded && (
                              <tr>
                                <td colSpan={8} style={{ padding: 0 }}>
                                  <div style={{
                                    padding: "16px 20px",
                                    background: "var(--panel-soft)",
                                    borderBottom: "1px solid var(--stroke)"
                                  }}>
                                    {/* Información principal - Nombres y estados */}
                                    <div style={{
                                      display: "grid",
                                      gridTemplateColumns: "repeat(3, 1fr)",
                                      gap: "16px",
                                      fontSize: "12px",
                                      marginBottom: "16px"
                                    }}>
                                      {cycle.subscription?.plan?.name && (
                                        <div>
                                          <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>Plan</div>
                                          <div style={{ fontSize: "13px", fontWeight: 600 }}>{cycle.subscription.plan.name}</div>
                                        </div>
                                      )}

                                      <div>
                                        <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>Estado</div>
                                        <span className={`pill pill-sm ${status.class}`}>{status.label}</span>
                                      </div>

                                      <div>
                                        <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>Puntualidad</div>
                                        <span className={`pill pill-sm ${punctual.class}`}>{punctual.label}</span>
                                      </div>

                                      {cycle.associationReason && (
                                        <div>
                                          <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>Razón Asociación</div>
                                          <div style={{ fontSize: "12px" }}>{cycle.associationReason}</div>
                                        </div>
                                      )}

                                      <div>
                                        <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>Origen</div>
                                        <span className={`pill pill-sm ${origin.class}`}>{origin.label}</span>
                                      </div>

                                      {typeof cycle.daysEarly === "number" && cycle.daysEarly > 0 && (
                                        <div>
                                          <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>Días Temprano</div>
                                          <div style={{ fontSize: "12px", color: "var(--status-ok)", fontWeight: 500 }}>{cycle.daysEarly} días</div>
                                        </div>
                                      )}

                                      {typeof cycle.daysLate === "number" && cycle.daysLate > 0 && (
                                        <div>
                                          <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>Días Tarde</div>
                                          <div style={{ fontSize: "12px", color: "var(--status-danger)", fontWeight: 500 }}>{cycle.daysLate} días</div>
                                        </div>
                                      )}
                                    </div>

                                    {cycle.paymentId ? (
                                      <form
                                        action={movePaymentToCycle}
                                        className="cycle-move-form"
                                        style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}
                                      >
                                        <input type="hidden" name="csrf" value={csrfToken} />
                                        <input type="hidden" name="paymentId" value={cycle.paymentId} />
                                        <input type="hidden" name="subscriptionId" value={cycle.subscriptionId} />
                                        <input type="hidden" name="tenantId" value={String(tenantId || "")} />
                                        <input type="hidden" name="returnTo" value={returnTo} />
                                        <select className="select select-sm" name="cycleId" defaultValue="">
                                          <option value="">Mover pago a…</option>
                                          {items
                                            .filter((c) => c.id !== cycle.id && !c.paymentId)
                                            .map((c) => (
                                              <option key={`move-${cycle.id}-${c.id}`} value={c.id}>
                                                Ciclo {c.cycleNumber} · {new Date(c.periodStartAt).toLocaleDateString("es-CO")} → {new Date(c.periodEndAt).toLocaleDateString("es-CO")}
                                              </option>
                                            ))}
                                        </select>
                                        <button className="ghost btn-compact btn-noicon" type="submit">
                                          Mover pago
                                        </button>
                                      </form>
                                    ) : null}

                                    {/* IDs - Información técnica al final */}
                                    <div style={{
                                      paddingTop: "16px",
                                      borderTop: "1px dashed var(--stroke)",
                                      display: "grid",
                                      gridTemplateColumns: "repeat(3, 1fr)",
                                      gap: "16px",
                                      fontSize: "11px"
                                    }}>
                                      <div>
                                        <div style={{ fontSize: "9px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>ID Ciclo</div>
                                        <code style={{ fontSize: "10px", background: "var(--panel)", padding: "4px 6px", borderRadius: "4px", display: "block", wordBreak: "break-all", color: "var(--text-faint)" }}>
                                          {cycle.id}
                                        </code>
                                      </div>

                                      {cycle.paymentId && (
                                        <div>
                                          <div style={{ fontSize: "9px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>ID Pago</div>
                                          <code style={{ fontSize: "10px", background: "var(--panel)", padding: "4px 6px", borderRadius: "4px", display: "block", wordBreak: "break-all", color: "var(--text-faint)" }}>
                                            {cycle.paymentId}
                                          </code>
                                        </div>
                                      )}

                                      <div>
                                        <div style={{ fontSize: "9px", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "4px" }}>ID Suscripción</div>
                                        <code style={{ fontSize: "10px", background: "var(--panel)", padding: "4px 6px", borderRadius: "4px", display: "block", wordBreak: "break-all", color: "var(--text-faint)" }}>
                                          {cycle.subscriptionId}
                                        </code>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
        </div>
      </AppModal>
    </>
  );
}
