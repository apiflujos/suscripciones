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
  if (!links.length) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Links generados</h3>
          <button type="button" className="ghost modal-close" onClick={onClose} data-loader="off">X</button>
        </div>

        <div style={{ display: "grid", gap: 16, padding: "16px 0" }}>
          {links.map((link, idx) => (
            <div key={idx} style={{ display: "grid", gap: 6 }}>
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
                <input
                  className="input"
                  type="text"
                  value={link.url}
                  readOnly
                  style={{ flex: 1, fontSize: 11, fontFamily: "monospace" }}
                />
                <CopyButton text={link.url} />
              </div>

              {(link.sentAt || link.expiresAt) && (
                <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
                  {link.sentAt && <span>Enviado: {new Date(link.sentAt).toLocaleString()} · </span>}
                  {link.expiresAt && <span>Expira: {new Date(link.expiresAt).toLocaleString()}</span>}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="module-footer" style={{ justifyContent: "flex-end" }}>
          <button className="primary" type="button" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
