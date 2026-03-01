"use client";

import { useState } from "react";
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

export function LogsSystemTable({ items }: { items: LogItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="panel module" style={{ padding: 0 }}>
      <table className="table logs-table" aria-label="Tabla de logs">
        <colgroup>
          <col style={{ width: "9%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "41%" }} />
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
            const chip = toStatusChip(String(l.level || ""));
            const isOpen = Boolean(id) && openId === id;
            const rawMessage = String(l.message || "—");
            const shortMessage = rawMessage.length > 300 ? `${rawMessage.slice(0, 300)}…` : rawMessage;
            return (
              <tr key={id || `${l.createdAt ?? ""}-${l.message ?? ""}-${idx}`}>
                <td className="log-date-cell"><LocalDateTime value={l.createdAt} variant="stacked" /></td>
                <td>{(l as any).actor || "—"}</td>
                <td className="log-cell log-entity" title={(l as any).entity || l.source || "—"}>
                  <span className="log-truncate">{(l as any).entity || l.source || "—"}</span>
                </td>
                <td>
                  <span className={`status-chip ${chip.cls}`}>
                    <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                    {chip.label}
                  </span>
                </td>
                <td className="log-cell log-detail" title={rawMessage || "—"}>
                  <span className="log-truncate">{shortMessage}</span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <div className="inline-detail">
                    <button
                      className="ghost btn-eye btn-compact"
                      type="button"
                      aria-expanded={isOpen}
                      data-loader="off"
                      onClick={() => setOpenId(isOpen ? null : id)}
                    >
                      {isOpen ? "Ocultar" : "Ver"}
                    </button>
                    {isOpen ? (
                      <div className="inline-detail-body">
                        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{l.source || "—"}</div>
                        <pre className="inline-detail-pre">{JSON.stringify(l.context ?? l, null, 2)}</pre>
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
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
