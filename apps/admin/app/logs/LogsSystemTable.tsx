"use client";

import { Fragment, useState } from "react";
import { LocalDateTime } from "../ui/LocalDateTime";

type LogItem = {
  id?: string | number;
  createdAt?: string | Date | null;
  source?: string;
  level?: string;
  message?: string;
  context?: any;
};

function toStatusChip(level: string) {
  const v = String(level || "").toUpperCase();
  if (v === "ERROR") return { cls: "is-error", label: "Error" };
  if (v === "WARN") return { cls: "is-warning", label: "Advertencia" };
  return { cls: "is-success", label: "Exitoso" };
}

function resolveLogChip(item: LogItem) {
  const source = String(item.source || "").trim().toLowerCase();
  const message = String(item.message || "").trim().toLowerCase();
  if (
    source === "notifications.schedule" &&
    (message.includes("sin entrega") || message.includes("sin programación") || message.includes("sin programacion"))
  ) {
    return { cls: "is-warning", label: "Sin entrega" };
  }
  return toStatusChip(String(item.level || ""));
}

export function LogsSystemTable({ items }: { items: LogItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="panel module" style={{ padding: 0 }}>
      <table className="table logs-table" aria-label="Tabla de logs">
        <colgroup>
          <col style={{ width: "8%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "37%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Actor</th>
            <th>Entidad</th>
            <th>Estado</th>
            <th>Detalle</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((l, idx) => {
            const id = String(l.id ?? "");
            const chip = resolveLogChip(l);
            const isOpen = Boolean(id) && openId === id;
            const rawMessage = String(l.message || "—");
            const shortMessage = rawMessage.length > 300 ? `${rawMessage.slice(0, 300)}…` : rawMessage;
            const rowKey = id || `${l.createdAt ?? ""}-${l.message ?? ""}-${idx}`;
            return (
              <Fragment key={rowKey}>
              <tr>
                <td className="log-date-cell"><LocalDateTime value={l.createdAt} variant="stacked" /></td>
                <td>{(l as any).actor || "—"}</td>
                <td className="log-cell log-entity" title={(l as any).entity || l.source || "—"}>
                  <span className="log-truncate">{(l as any).entity || l.source || "—"}</span>
                </td>
                <td className="log-status-cell">
                  <span className={`status-chip ${chip.cls}`}>
                    <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                    {chip.label}
                  </span>
                </td>
                <td className="log-cell log-detail" title={rawMessage || "—"}>
                  <span className="log-truncate">{shortMessage}</span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="ghost btn-eye btn-compact"
                    type="button"
                    aria-expanded={isOpen}
                    data-loader="off"
                    onClick={() => setOpenId(isOpen ? null : id)}
                  >
                    {isOpen ? "Ocultar" : "Ver"}
                  </button>
                </td>
              </tr>
              {isOpen ? (
                <tr className="log-detail-row">
                  <td colSpan={6}>
                    <div className="log-detail-expanded">
                      <div className="log-detail-meta">{l.source || "—"}</div>
                      <pre className="log-detail-pre">{JSON.stringify(l.context ?? l, null, 2)}</pre>
                    </div>
                  </td>
                </tr>
              ) : null}
              </Fragment>
            );
          })}
          {items.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ color: "var(--muted)" }}>
                Sin logs.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
