"use client";

import { useEffect, useState, Fragment } from "react";
import { AppModal } from "../ui/AppModal";
import { LocalDateTime } from "../ui/LocalDateTime";
import { movePaymentToCycle, autoAssociatePaymentToCycle } from "./actions";

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

type PaymentCandidate = {
  cycle: {
    id: string;
    cycleNumber: number;
    periodStartAt: string;
    periodEndAt: string;
    dueAt: string;
    status: string;
  };
  payment: {
    id: string;
    amountInCents: number;
    currency: string;
    status: string;
    paidAt: string | null;
    createdAt: string;
    reference: string | null;
    wompiTransactionId: string | null;
    origin: string | null;
    cycleNumber: number | null;
  };
  score: number;
  reasons: string[];
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

function fmtMoney(cents: number, currency = "COP") {
  const major = Math.trunc(Number(cents || 0) / 100);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(major);
}

function reasonLabel(reason: string) {
  const map: Record<string, string> = {
    monto_exact: "💰 Monto exacto",
    en_rango: "📅 En rango del ciclo",
    cerca_del_vencimiento: "⏰ Cerca del vencimiento",
    referencia_coincide: "🏷️ Referencia coincide"
  };
  return map[reason] || reason;
}

export function BillingCyclesModal({ subscriptionId, csrfToken, returnTo, tenantId, trigger, forceOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<BillingCycleItem[]>([]);
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);

  // Auto-associate state
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [candidates, setCandidates] = useState<PaymentCandidate[]>([]);
  const [autoAssociating, setAutoAssociating] = useState<string | null>(null);
  const [autoResult, setAutoResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);

  // Manual search state
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedCycleForManual, setSelectedCycleForManual] = useState<string | null>(null);

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

  // Auto-associate handler
  const handleAutoAssociate = async () => {
    setAutoLoading(true);
    setCandidates([]);
    setAutoResult(null);
    setAutoModalOpen(true);

    try {
      const res = await fetch(`/api/billing/cycle-candidates?subscriptionId=${encodeURIComponent(subscriptionId)}`);
      const json = await res.json();

      if (!json.ok || !json.candidates) {
        setCandidates([]);
        return;
      }
      setCandidates(json.candidates);
    } catch {
      setCandidates([]);
    } finally {
      setAutoLoading(false);
    }
  };

  const handleConfirmAssociation = async (candidate: PaymentCandidate) => {
    const key = `${candidate.cycle.id}-${candidate.payment.id}`;
    setAutoAssociating(key);
    setAutoResult(null);

    const formData = new FormData();
    formData.set("csrf", csrfToken);
    formData.set("subscriptionId", subscriptionId);
    formData.set("cycleId", candidate.cycle.id);
    formData.set("paymentId", candidate.payment.id);
    if (tenantId) formData.set("tenantId", tenantId);

    try {
      const result = await autoAssociatePaymentToCycle(formData);
      if (result.ok) {
        setAutoResult({ ok: true, message: `Ciclo ${candidate.cycle.cycleNumber} asociado exitosamente` });
        // Refresh cycles list
        const res = await fetch(`/api/billing/billing-cycles?subscriptionId=${encodeURIComponent(subscriptionId)}&take=36`);
        const json = await res.json();
        if (json.ok && Array.isArray(json.items)) setItems(json.items);
        // Remove associated candidate from list
        setCandidates((prev) => prev.filter((c) => c.payment.id !== candidate.payment.id));
        // Close auto-modal after showing success
        setTimeout(() => {
          setAutoModalOpen(false);
          setCandidates([]);
          setAutoResult(null);
        }, 1500);
      } else {
        setAutoResult({ ok: false, error: result.error || "association_failed" });
      }
    } catch {
      setAutoResult({ ok: false, error: "network_error" });
    } finally {
      setAutoAssociating(null);
    }
  };

  // Manual search handler
  const handleManualSearch = async () => {
    if (!selectedCycleForManual || !searchQuery.trim()) return;
    setSearchLoading(true);

    try {
      const res = await fetch(
        `/api/billing/payment-history?subscriptionId=${encodeURIComponent(subscriptionId)}&take=50`
      );
      const json = await res.json();
      const payments = Array.isArray(json?.items) ? json.items : [];

      // Filter by search query (txId, reference, amount)
      const q = searchQuery.toLowerCase();
      const filtered = payments.filter((p: any) =>
        String(p.wompiTransactionId || "").toLowerCase().includes(q) ||
        String(p.reference || "").toLowerCase().includes(q) ||
        String(p.amountInCents || "").includes(q)
      );
      setSearchResults(filtered);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleManualAssociate = async (paymentId: string) => {
    if (!selectedCycleForManual) return;

    const formData = new FormData();
    formData.set("csrf", csrfToken);
    formData.set("subscriptionId", subscriptionId);
    formData.set("cycleId", selectedCycleForManual);
    formData.set("paymentId", paymentId);
    if (tenantId) formData.set("tenantId", tenantId);

    const result = await autoAssociatePaymentToCycle(formData);
    if (result.ok) {
      // Refresh
      const res = await fetch(`/api/billing/billing-cycles?subscriptionId=${encodeURIComponent(subscriptionId)}&take=36`);
      const json = await res.json();
      if (json.ok && Array.isArray(json.items)) setItems(json.items);
      setSearchModalOpen(false);
      setSelectedCycleForManual(null);
      setSearchResults([]);
    }
  };

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

  const pendingCyclesCount = items.filter((c) => c.status === "PENDING" || c.status === "FAILED").length;

  return (
    <>
      {triggerButton}

      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        title={
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <span>Ciclos de Pago</span>
            <span className="pill pill-sm pill-muted">{items.length} ciclos</span>
            {pendingCyclesCount > 0 && (
              <button
                className="ghost btn-compact btn-send"
                type="button"
                onClick={handleAutoAssociate}
                title="Buscar y asociar pagos automáticamente"
              >
                🔗 Asociar automáticamente
              </button>
            )}
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
                        <th style={{ width: "80px", textAlign: "center" }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((cycle) => {
                        const status = statusLabel(cycle.status);
                        const punctual = punctualityLabel(cycle);
                        const origin = originLabel(cycle.origin);
                        const isExpanded = expandedCycle === cycle.id;
                        const isPending = cycle.status === "PENDING" || cycle.status === "FAILED";

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
                                <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
                                  {isPending && (
                                    <button
                                      className="ghost btn-compact btn-noicon"
                                      type="button"
                                      title="Buscar pago manualmente"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedCycleForManual(cycle.id);
                                        setSearchModalOpen(true);
                                        setSearchResults([]);
                                        setSearchQuery("");
                                      }}
                                    >
                                      🔍
                                    </button>
                                  )}
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
                                </div>
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

      {/* ── MODAL: Auto-associate ── */}
      <AppModal
        open={autoModalOpen}
        onClose={() => { setAutoModalOpen(false); setCandidates([]); setAutoResult(null); }}
        title="Asociar pagos automáticamente"
        width="min(700px, 96vw)"
      >
        <div style={{ padding: "8px 0" }}>
          {autoLoading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-faint)" }}>
              <div className="loading-spinner" style={{ margin: "0 auto 12px" }} />
              Buscando pagos no asociados...
            </div>
          ) : candidates.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center" }}>
              <div style={{ fontSize: "36px", marginBottom: "12px", opacity: 0.3 }}>🔍</div>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>No se encontraron pagos automáticos</div>
              <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                No hay pagos sin asociar que coincidan con los ciclos pendientes.
                Puedes intentar la asociación manual desde el ciclo.
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="field-hint" style={{ marginBottom: 8 }}>
                Se encontraron <strong>{candidates.length}</strong> posible(s) coincidencia(s). Revisa y confirma cada asociación.
              </div>

              {autoResult && (
                <div
                  className={autoResult.ok ? "paylink-success" : "paylink-error"}
                  style={{ marginBottom: 8 }}
                >
                  {autoResult.ok ? autoResult.message : `Error: ${autoResult.error}`}
                </div>
              )}

              {candidates.map((candidate, idx) => {
                const key = `${candidate.cycle.id}-${candidate.payment.id}`;
                const isAssociating = autoAssociating === key;

                return (
                  <div
                    key={key}
                    style={{
                      padding: "12px 16px",
                      background: "var(--panel-soft)",
                      border: "1px solid var(--stroke)",
                      borderRadius: 8
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <span className="pill pill-sm pill-warn">Ciclo {candidate.cycle.cycleNumber}</span>
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>
                            {new Date(candidate.cycle.periodStartAt).toLocaleDateString("es-CO")} → {new Date(candidate.cycle.periodEndAt).toLocaleDateString("es-CO")}
                          </span>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                          <div>
                            <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-faint)" }}>Pago</div>
                            <div style={{ fontWeight: 500 }}>
                              {fmtMoney(candidate.payment.amountInCents, candidate.payment.currency)}
                            </div>
                            {candidate.payment.paidAt && (
                              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                Pagado: {new Date(candidate.payment.paidAt).toLocaleDateString("es-CO")}
                              </div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-faint)" }}>Coincidencia</div>
                            <div style={{ fontWeight: 600, color: candidate.score >= 80 ? "var(--status-ok)" : "var(--status-warning)" }}>
                              {candidate.score}%
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>
                              {candidate.reasons.map(reasonLabel).join(", ")}
                            </div>
                          </div>
                        </div>

                        {candidate.payment.wompiTransactionId && (
                          <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6 }}>
                            Tx: <code>{candidate.payment.wompiTransactionId}</code>
                          </div>
                        )}
                      </div>

                      <button
                        className="primary btn-compact"
                        type="button"
                        disabled={isAssociating}
                        onClick={() => handleConfirmAssociation(candidate)}
                      >
                        {isAssociating ? "Asociando..." : "✓ Confirmar"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
            <button
              className="ghost btn-compact"
              type="button"
              onClick={() => { setAutoModalOpen(false); setCandidates([]); setAutoResult(null); }}
            >
              Cerrar
            </button>
          </div>
        </div>
      </AppModal>

      {/* ── MODAL: Manual search ── */}
      <AppModal
        open={searchModalOpen}
        onClose={() => { setSearchModalOpen(false); setSelectedCycleForManual(null); setSearchResults([]); setSearchQuery(""); }}
        title="Buscar pago para asociar"
        width="min(600px, 96vw)"
      >
        <div style={{ padding: "8px 0" }}>
          <div className="field">
            <label>Buscar pago</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ID transacción, referencia o monto..."
                onKeyDown={(e) => { if (e.key === "Enter") handleManualSearch(); }}
              />
              <button
                className="primary btn-compact"
                type="button"
                onClick={handleManualSearch}
                disabled={!searchQuery.trim() || searchLoading}
              >
                {searchLoading ? "..." : "Buscar"}
              </button>
            </div>
          </div>

          {searchResults.length === 0 && searchQuery && (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No se encontraron pagos con "{searchQuery}"
            </div>
          )}

          {searchResults.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              {searchResults.map((p: any) => (
                <div
                  key={p.id}
                  style={{
                    padding: "10px 14px",
                    background: "var(--panel-soft)",
                    border: "1px solid var(--stroke)",
                    borderRadius: 6,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <div style={{ fontSize: 13 }}>
                    <div style={{ fontWeight: 500 }}>{fmtMoney(p.amountInCents, p.currency)}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {p.wompiTransactionId ? `Tx: ${p.wompiTransactionId}` : p.reference}
                    </div>
                    {p.paidAt && (
                      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
                        {new Date(p.paidAt).toLocaleDateString("es-CO")}
                      </div>
                    )}
                  </div>
                  <button
                    className="ghost btn-compact"
                    type="button"
                    onClick={() => handleManualAssociate(p.id)}
                  >
                    Asociar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button
              className="ghost btn-compact"
              type="button"
              onClick={() => { setSearchModalOpen(false); setSelectedCycleForManual(null); setSearchResults([]); setSearchQuery(""); }}
            >
              Cerrar
            </button>
          </div>
        </div>
      </AppModal>
    </>
  );
}
