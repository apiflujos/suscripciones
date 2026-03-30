"use client";

import { useState } from "react";
import { CopyButton } from "../ui/CopyButton";

type LinkItem = {
  label: string;
  url: string;
  sentAt?: string;
  usedAt?: string;
  expiresAt?: string;
  isValid: boolean;
};

export function ViewLinksModal({
  links,
  onClose
}: {
  links: LinkItem[];
  onClose: () => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!links.length) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Links generados</h3>
          <button type="button" className="ghost modal-close" onClick={onClose} data-loader="off">X</button>
        </div>

        <div style={{ display: "grid", gap: 12, padding: "16px 0" }}>
          {links.map((link, idx) => (
            <div key={idx} style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{link.label}</strong>
                {link.isValid ? (
                  <span className="pill pill-sm pill-ok">Válido</span>
                ) : (
                  <span className="pill pill-sm pill-muted">
                    {link.usedAt ? "Usado" : link.expiresAt ? "Expirado" : "Inválido"}
                  </span>
                )}
              </div>
              
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="ghost btn-compact btn-blue"
                  onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
                  style={{ flex: 1, textAlign: "left", fontSize: 12 }}
                  title={link.url}
                >
                  🔗 {expandedIndex === idx ? "Ocultar link" : "Ver link"}
                </button>
                <CopyButton text={link.url} />
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ghost btn-compact btn-icon-only"
                  title="Abrir en nueva pestaña"
                  style={{ minWidth: 32 }}
                >
                  ↗
                </a>
              </div>

              {expandedIndex === idx && (
                <div style={{ 
                  background: "var(--surface-2)", 
                  padding: "8px 10px", 
                  borderRadius: 6,
                  fontSize: 10,
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                  color: "var(--text-soft)",
                  border: "1px solid var(--stroke)"
                }}>
                  {link.url}
                </div>
              )}

              {(link.sentAt || link.expiresAt) && (
                <div style={{ fontSize: 9, color: "var(--text-faint)" }}>
                  {link.sentAt && <span>Enviado: {new Date(link.sentAt).toLocaleString()} · </span>}
                  {link.expiresAt && <span>Expira: {new Date(link.expiresAt).toLocaleString()}</span>}
                  {link.usedAt && <span>Usado: {new Date(link.usedAt).toLocaleString()}</span>}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="module-footer" style={{ justifyContent: "flex-end" }}>
          <button className="primary btn-compact btn-noicon" type="button" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
