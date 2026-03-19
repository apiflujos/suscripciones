"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { LocalDateTime } from "../ui/LocalDateTime";

type Attempt = {
  id: string;
  status?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: string | null;
};

type PaymentItem = {
  id: string;
  status?: string | null;
  amountInCents?: number | null;
  currency?: string | null;
  paidAt?: string | null;
  failedAt?: string | null;
  createdAt?: string | null;
  wompiTransactionId?: string | null;
  reference?: string | null;
  attempts?: Attempt[];
};

type Props = {
  subscriptionId: string;
  tenantId?: string | null;
};

function statusClass(status?: string | null) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED") return "pill-ok";
  if (s === "DECLINED" || s === "ERROR" || s === "VOIDED") return "pill-bad";
  if (s === "PENDING") return "pill-warn";
  return "pill-muted";
}

function statusLabel(status?: string | null) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED") return "Aprobado";
  if (s === "DECLINED") return "Rechazado";
  if (s === "ERROR") return "Error";
  if (s === "VOIDED") return "Anulado";
  if (s === "PENDING") return "Pendiente";
  return s || "—";
}

function fmtMoney(cents?: number | null, currency?: string | null) {
  const value = Number(cents || 0) / 100;
  const cur = String(currency || "COP");
  return value.toLocaleString("es-CO", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 0
  });
}

export function PaymentHistoryButton({ subscriptionId, tenantId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PaymentItem[]>([]);
  const [error, setError] = useState<string>("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const take = 10;

  const url = useMemo(() => {
    const qs = new URLSearchParams({ subscriptionId, take: String(take), page: String(page) });
    if (tenantId) qs.set("tenantId", tenantId);
    if (statusFilter) qs.set("status", statusFilter);
    return `/api/billing/payment-history?${qs.toString()}`;
  }, [subscriptionId, tenantId, page, statusFilter]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    fetch(url, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!active) return;
        if (!ok) {
          setError(String(json?.error || "No se pudo cargar el historial."));
          setItems([]);
          setTotal(0);
          return;
        }
        setItems(Array.isArray(json?.items) ? json.items : []);
        setTotal(Number(json?.total || 0));
      })
      .catch(() => {
        if (!active) return;
        setError("No se pudo cargar el historial.");
        setItems([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, url]);

  useEffect(() => {
    if (!open) return;
    setPage(1);
  }, [statusFilter, open]);

  const totalPages = Math.max(1, Math.ceil(total / take));

  return (
    <>
      <button
        type="button"
        className="ghost btn-compact btn-history btn-icon-only"
        aria-label="Historial de pagos"
        title="Historial de pagos"
        onClick={() => setOpen(true)}
      />
      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(760px, 96vw)" }}>
            <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Historial de pagos</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <div className="billing-history">
              <div className="billing-history-controls">
                <label className="billing-history-label">
                  Estado
                  <select
                    className="select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">Todos</option>
                    <option value="APPROVED">Aprobado</option>
                    <option value="PENDING">Pendiente</option>
                    <option value="DECLINED">Rechazado</option>
                    <option value="ERROR">Error</option>
                    <option value="VOIDED">Anulado</option>
                  </select>
                </label>
                <div className="billing-history-pages">
                  <button
                    type="button"
                    className="ghost btn-compact"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                  >
                    Anterior
                  </button>
                  <span className="billing-history-page-info">
                    Página {page} de {totalPages}
                  </span>
                  <button
                    type="button"
                    className="ghost btn-compact"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
              {loading ? <div className="muted">Cargando historial...</div> : null}
              {error ? <div className="muted">{error}</div> : null}
              {!loading && !error && items.length === 0 ? <div className="muted">Sin pagos registrados.</div> : null}
              {!loading && !error && items.length > 0 ? (
                <div className="billing-history-table-wrap">
                  <table className="table billing-history-table" aria-label="Historial de pagos">
                    <thead>
                      <tr>
                        <th>Estado</th>
                        <th>Monto</th>
                        <th>Fecha</th>
                        <th>Referencia</th>
                        <th>Wompi</th>
                        <th>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p) => (
                        <Fragment key={p.id}>
                          <tr key={p.id}>
                            <td>
                              <span className={`pill pill-sm ${statusClass(p.status)}`}>{statusLabel(p.status)}</span>
                            </td>
                            <td className="billing-history-amount">{fmtMoney(p.amountInCents, p.currency)}</td>
                            <td className="billing-history-date">
                              <LocalDateTime value={p.paidAt || p.failedAt || p.createdAt || null} variant="short" />
                            </td>
                            <td className="billing-history-ref">{p.reference || "—"}</td>
                            <td className="billing-history-wompi">{p.wompiTransactionId || "—"}</td>
                            <td className="billing-history-detail">
                              {Array.isArray(p.attempts) && p.attempts.length
                                ? `${p.attempts.length} intento${p.attempts.length > 1 ? "s" : ""}`
                                : "—"}
                            </td>
                          </tr>
                          {Array.isArray(p.attempts) && p.attempts.length ? (
                            <tr key={`${p.id}-attempts`} className="billing-history-attempts-row">
                              <td colSpan={6}>
                                <div className="billing-history-attempts">
                                  {p.attempts.map((a) => (
                                    <div key={a.id} className="billing-history-attempt">
                                      <span className={`pill pill-sm ${statusClass(a.status)}`}>{statusLabel(a.status)}</span>
                                      <span className="billing-history-attempt-date">
                                        <LocalDateTime value={a.createdAt || null} variant="short" />
                                      </span>
                                      {a.errorMessage || a.errorCode ? (
                                        <span className="billing-history-attempt-error">
                                          {a.errorMessage || a.errorCode}
                                        </span>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
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
