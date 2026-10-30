"use client";

import { useState } from "react";

/** "Sincronizar plantillas" de Chatwoot: consulta en línea y muestra el resultado en el sitio. */
export function TemplatesSyncPanel() {
  const [templatesSync, setTemplatesSync] = useState<{ running: boolean; count: number; error: string; syncWarning: string }>({
    running: false,
    count: 0,
    error: "",
    syncWarning: ""
  });

  const syncWhatsappTemplates = async () => {
    setTemplatesSync({ running: true, count: 0, error: "", syncWarning: "" });
    try {
      const res = await fetch("/admin/comms?op=whatsapp_templates", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "sync_failed");
      const count = Array.isArray(json?.templates) ? json.templates.length : 0;
      const syncWarning =
        json?.sync?.ok === false
          ? `La sincronizacion con WhatsApp fallo: ${json.sync.error || "sync_failed"}. Las plantillas mostradas pueden estar desactualizadas.`
          : "";
      setTemplatesSync({ running: false, count, error: "", syncWarning });
    } catch (err: any) {
      setTemplatesSync({ running: false, count: 0, error: String(err?.message || "sync_failed"), syncWarning: "" });
    }
  };

  return (
    <div className="panel module">
      <div className="panelHeaderRow settings-sync-row">
        <strong>Chatwoot · Plantillas WhatsApp</strong>
        <div className="settings-sync-actions">
          <button className="ghost btn-compact" type="button" onClick={syncWhatsappTemplates} disabled={templatesSync.running} data-loader="off">
            {templatesSync.running ? "Sincronizando..." : "Sincronizar plantillas"}
          </button>
          <span className="field-hint">
            {templatesSync.count ? `Sincronizadas: ${templatesSync.count}` : "Trae las plantillas activas desde Chatwoot."}
          </span>
        </div>
      </div>
      {templatesSync.error ? (
        <div className="field-hint" role="alert" style={{ color: "var(--danger)" }}>
          Error: {templatesSync.error}
        </div>
      ) : templatesSync.syncWarning ? (
        <div className="field-hint" style={{ color: "var(--warning, #b45309)" }}>
          {templatesSync.syncWarning}
        </div>
      ) : null}
    </div>
  );
}
