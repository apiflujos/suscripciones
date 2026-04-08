"use client";

import { useEffect, useState, Fragment } from "react";
import { AppModal } from "../ui/AppModal";
import { LocalDateTime } from "../ui/LocalDateTime";
import { movePaymentToCycle, autoAssociatePaymentToCycle } from "./actions";
import { formatCivilDate } from "./civilDate";

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

type PaymentSuggestion = {
  suggestedCycle: {
    id: string;
    cycleNumber: number;
    periodStartAt: string;
    periodEndAt: string;
    dueAt: string;
    status: string;
  } | null;
  alternativeCycles: Array<{
    id: string;
    cycleNumber: number;
    periodStartAt: string;
    periodEndAt: string;
    dueAt: string;
    status: string;
  }>;
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
  explanation: string;
  reasonCode: "EN_CURSO" | "ANTICIPADO" | "REFERENCE_MATCH" | "FALLBACK";
  requiresManualReview: boolean;
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

function formatDateRange(start: string, end: string) {
  return (
    <span>
      {formatCivilDate(start)} · {formatCivilDate(end)}
    </span>
  );
}

function iconStyle(size = 16) {
  return { width: size, height: size, display: "block", flex: "0 0 auto" } as const;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={iconStyle(16)} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={iconStyle(16)} aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 1 0-7.07-7.07L10.7 5.23" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 1 0 7.07 7.07l1.41-1.41" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={iconStyle(16)} aria-hidden="true">
      <path d="M17 2v6h-6" />
      <path d="M7 22v-6h6" />
      <path d="M20 11a8 8 0 0 0-13.66-5.66L5 7" />
      <path d="M4 13a8 8 0 0 0 13.66 5.66L19 17" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={iconStyle(36)} aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </svg>
  );
}

function autoReasonLabel(reason: PaymentSuggestion["reasonCode"]) {
  if (reason === "ANTICIPADO") return "Pago anticipado";
  if (reason === "REFERENCE_MATCH") return "Referencia o ciclo inferido";
  if (reason === "FALLBACK") return "Revisión manual recomendada";
  return "Pago en curso";
}

export function BillingCyclesModal({ subscriptionId, csrfToken, returnTo, tenantId, trigger, forceOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<BillingCycleItem[]>([]);
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);

  // Auto-associate state
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<PaymentSuggestion[]>([]);
  const [selectedCycleByPayment, setSelectedCycleByPayment] = useState<Record<string, string>>({});
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
    setSuggestions([]);
    setSelectedCycleByPayment({});
    setAutoResult(null);
    setAutoModalOpen(true);

    try {
      const res = await fetch(`/api/billing/cycle-candidates?subscriptionId=${encodeURIComponent(subscriptionId)}`);
      const json = await res.json();

      if (!json.ok || !json.suggestions) {
        setSuggestions([]);
        return;
      }
      const nextSuggestions = Array.isArray(json.suggestions) ? json.suggestions : [];
      setSuggestions(nextSuggestions);
      setSelectedCycleByPayment(
        Object.fromEntries(
          nextSuggestions
            .filter((entry: PaymentSuggestion) => entry.suggestedCycle?.id)
            .map((entry: PaymentSuggestion) => [entry.payment.id, String(entry.suggestedCycle?.id || "")])
        )
      );
    } catch {
      setSuggestions([]);
    } finally {
      setAutoLoading(false);
    }
  };

  const handleConfirmAssociation = async (suggestion: PaymentSuggestion) => {
    const selectedCycleId = String(selectedCycleByPayment[suggestion.payment.id] || suggestion.suggestedCycle?.id || "").trim();
    if (!selectedCycleId) {
      setAutoResult({ ok: false, error: "selected_cycle_required" });
      return;
    }
    const selectedCycle = suggestion.alternativeCycles.find((cycle) => cycle.id === selectedCycleId) || suggestion.suggestedCycle;
    if (!selectedCycle) {
      setAutoResult({ ok: false, error: "selected_cycle_not_found" });
      return;
    }
    if (suggestion.suggestedCycle?.id && selectedCycle.id !== suggestion.suggestedCycle.id) {
      const confirmed = window.confirm(`Este pago se moverá del ciclo sugerido ${suggestion.suggestedCycle.cycleNumber} al ciclo ${selectedCycle.cycleNumber}. ¿Continuar?`);
      if (!confirmed) return;
    }

    const key = `${selectedCycle.id}-${suggestion.payment.id}`;
    setAutoAssociating(key);
    setAutoResult(null);

    const formData = new FormData();
    formData.set("csrf", csrfToken);
    formData.set("subscriptionId", subscriptionId);
    formData.set("cycleId", selectedCycle.id);
    formData.set("paymentId", suggestion.payment.id);
    if (tenantId) formData.set("tenantId", tenantId);

    try {
      const result = await autoAssociatePaymentToCycle(formData);
      if (result.ok) {
        setAutoResult({ ok: true, message: `Pago asociado al ciclo ${selectedCycle.cycleNumber}.` });
        // Refresh cycles list
        const res = await fetch(`/api/billing/billing-cycles?subscriptionId=${encodeURIComponent(subscriptionId)}&take=36`);
        const json = await res.json();
        if (json.ok && Array.isArray(json.items)) setItems(json.items);
        setSuggestions((prev) => prev.filter((entry) => entry.payment.id !== suggestion.payment.id));
        // Close auto-modal after showing success
        setTimeout(() => {
          setAutoModalOpen(false);
          setSuggestions([]);
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
        `/api/billing/payment-history?subscriptionId=${encodeURIComponent(subscriptionId)}&includeUnlinked=1&take=20&q=${encodeURIComponent(searchQuery.trim())}`
      );
      const json = await res.json();
      setSearchResults(Array.isArray(json?.items) ? json.items : []);
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
  const autoOpenCycles = items.filter((c) => !c.paymentId && (c.status === "PENDING" || c.status === "FAILED"));

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
                <span>Asociar pagos</span>
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
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px", opacity: 0.35 }}><EmptyIcon /></div>
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
                              <td style={{ textAlign: "left" }}>{formatCivilDate(cycle.dueAt)}</td>
                              <td style={{ textAlign: "left" }}>{cycle.paidAt ? <LocalDateTime value={cycle.paidAt} variant="short" /> : "—"}</td>
                              <td style={{ textAlign: "left" }}><span className={`pill pill-sm ${status.class}`}>{status.label}</span></td>
                              <td style={{ textAlign: "left" }}><span className={`pill pill-sm ${punctual.class}`}>{punctual.label}</span></td>
                              <td style={{ textAlign: "left" }}><span className={`pill pill-sm ${origin.class}`}>{origin.label}</span></td>
                              <td style={{ textAlign: "center" }}>
                                {isPending && (
                                  <button
                                    className="ghost btn-compact btn-noicon"
                                    type="button"
                                    title="Buscar pago manualmente"
                                    aria-label="Buscar pago manualmente"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedCycleForManual(cycle.id);
                                      setSearchModalOpen(true);
                                      setSearchResults([]);
                                      setSearchQuery("");
                                    }}
                                  >
                                    <SearchIcon />
                                  </button>
                                )}
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
                                                Ciclo {c.cycleNumber} · {formatCivilDate(c.periodStartAt)} → {formatCivilDate(c.periodEndAt)}
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
        onClose={() => { setAutoModalOpen(false); setSuggestions([]); setAutoResult(null); }}
        title="Pagos detectados"
        width="min(860px, 96vw)"
      >
        <div style={{ padding: "8px 0" }}>
          {autoLoading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-faint)" }}>
              <div className="loading-spinner" style={{ margin: "0 auto 12px" }} />
              Analizando pagos aprobados sin asociar...
            </div>
          ) : suggestions.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px", opacity: 0.35 }}><SearchIcon /></div>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>No hay pagos sugeridos</div>
              <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                No se encontraron pagos únicos listos para asociar automáticamente.
                Puedes buscar uno manualmente desde cada ciclo pendiente.
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 8,
                  marginBottom: 4
                }}
              >
                <div className="field-hint">Pagos únicos detectados: <strong>{suggestions.length}</strong></div>
                <div className="field-hint">Ciclos abiertos: <strong>{autoOpenCycles.length}</strong></div>
                <div className="field-hint">Regla activa: <strong>{suggestions[0]?.reasonCode === "ANTICIPADO" ? "Pago adelantado" : "Pago en curso"}</strong></div>
              </div>

              {autoResult && (
                <div
                  className={autoResult.ok ? "paylink-success" : "paylink-error"}
                  style={{ marginBottom: 8 }}
                >
                  {autoResult.ok ? autoResult.message : `Error: ${autoResult.error}`}
                </div>
              )}

              {suggestions.map((suggestion) => {
                const selectedCycleId = String(selectedCycleByPayment[suggestion.payment.id] || suggestion.suggestedCycle?.id || "");
                const selectedCycle =
                  suggestion.alternativeCycles.find((cycle) => cycle.id === selectedCycleId) || suggestion.suggestedCycle;
                const key = `${selectedCycleId || "none"}-${suggestion.payment.id}`;
                const isAssociating = autoAssociating === key;

                return (
                  <div
                    key={key}
                    style={{
                      padding: "16px 18px",
                      background: "linear-gradient(180deg, var(--panel-soft), color-mix(in srgb, var(--panel-soft) 84%, transparent))",
                      border: "1px solid var(--stroke)",
                      borderRadius: 12
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                          <span className="pill pill-sm pill-muted">{autoReasonLabel(suggestion.reasonCode)}</span>
                          {suggestion.requiresManualReview ? (
                            <span className="pill pill-sm pill-warn">Revisar antes de confirmar</span>
                          ) : (
                            <span className="pill pill-sm pill-ok">Sugerencia única</span>
                          )}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1.3fr) minmax(260px, 1fr)",
                            gap: 14,
                            alignItems: "start"
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 4 }}>Pago detectado</div>
                            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                              {fmtMoney(suggestion.payment.amountInCents, suggestion.payment.currency)}
                            </div>
                            <div style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                              <div>Fecha de pago: {suggestion.payment.paidAt ? formatCivilDate(suggestion.payment.paidAt) : formatCivilDate(suggestion.payment.createdAt)}</div>
                              <div>Estado: {suggestion.payment.status}</div>
                              <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                                transaction_id: <code>{suggestion.payment.wompiTransactionId || "Sin transaction_id"}</code>
                              </div>
                              {suggestion.payment.reference ? (
                                <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                                  Referencia: <code>{suggestion.payment.reference}</code>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 4 }}>Sugerencia</div>
                            {suggestion.suggestedCycle ? (
                              <>
                                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                                  Este pago se sugiere para el ciclo {suggestion.suggestedCycle.cycleNumber}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                                  {formatCivilDate(suggestion.suggestedCycle.periodStartAt)} → {formatCivilDate(suggestion.suggestedCycle.periodEndAt)}
                                </div>
                              </>
                            ) : (
                              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                                No se pudo sugerir un ciclo automáticamente.
                              </div>
                            )}

                            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                              {suggestion.explanation}
                            </div>

                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <select
                                className="select select-sm"
                                value={selectedCycleId}
                                onChange={(e) =>
                                  setSelectedCycleByPayment((prev) => ({
                                    ...prev,
                                    [suggestion.payment.id]: e.target.value
                                  }))
                                }
                                style={{ minWidth: 240, maxWidth: "100%" }}
                              >
                                <option value="">Selecciona un ciclo</option>
                                {suggestion.alternativeCycles.map((cycle) => (
                                  <option key={`${suggestion.payment.id}-${cycle.id}`} value={cycle.id}>
                                    Ciclo {cycle.cycleNumber} · {formatCivilDate(cycle.periodStartAt)} → {formatCivilDate(cycle.periodEndAt)}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="primary btn-compact"
                                type="button"
                                disabled={isAssociating || !selectedCycle}
                                onClick={() => handleConfirmAssociation(suggestion)}
                                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                              >
                                <LinkIcon />
                                <span>{isAssociating ? "Asociando..." : "Confirmar asignación"}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ minWidth: 180 }}>
                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            background: "var(--panel)",
                            border: "1px solid var(--stroke)"
                          }}
                        >
                          <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 6 }}>Ciclo elegido</div>
                          {selectedCycle ? (
                            <>
                              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Ciclo {selectedCycle.cycleNumber}</div>
                              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                                {formatCivilDate(selectedCycle.periodStartAt)} → {formatCivilDate(selectedCycle.periodEndAt)}
                              </div>
                            </>
                          ) : (
                            <div style={{ fontSize: 12, color: "var(--muted)" }}>Selecciona un ciclo manualmente.</div>
                          )}
                        </div>
                        {suggestion.suggestedCycle && selectedCycle && selectedCycle.id !== suggestion.suggestedCycle.id ? (
                          <button
                            className="ghost btn-compact"
                            type="button"
                            style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 8 }}
                            onClick={() =>
                              setSelectedCycleByPayment((prev) => ({
                                ...prev,
                                [suggestion.payment.id]: suggestion.suggestedCycle?.id || ""
                              }))
                            }
                          >
                            <RepeatIcon />
                            <span>Volver a sugerencia</span>
                          </button>
                        ) : null}
                      </div>
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
              onClick={() => { setAutoModalOpen(false); setSuggestions([]); setAutoResult(null); }}
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
            <label>Buscar pago aprobado</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="transaction_id, referencia, nombre o correo..."
                onKeyDown={(e) => { if (e.key === "Enter") handleManualSearch(); }}
              />
              <button
                className="primary btn-compact"
                type="button"
                onClick={handleManualSearch}
                disabled={!searchQuery.trim() || searchLoading}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <SearchIcon />
                <span>{searchLoading ? "Buscando..." : "Buscar"}</span>
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
                      {p.wompiTransactionId ? `transaction_id: ${p.wompiTransactionId}` : p.reference}
                    </div>
                    {p.paidAt && (
                      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
                        <LocalDateTime value={p.paidAt} variant="short" />
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
