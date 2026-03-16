"use client";

import { useMemo, useState } from "react";

type EntityType = "customers" | "products";

export function ListCsvActions({
  exportHref,
  tenantId,
  defaultEntity = "customers"
}: {
  exportHref: string;
  tenantId?: string;
  defaultEntity?: EntityType;
}) {
  const [open, setOpen] = useState(false);
  const [entity, setEntity] = useState<EntityType>(defaultEntity);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; details?: string[] } | null>(null);

  const templateHref = useMemo(() => `/api/import/template?entity=${encodeURIComponent(entity)}`, [entity]);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      setResult({ ok: false, message: "Selecciona un archivo CSV." });
      return;
    }
    setUploading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("entity", entity);
      fd.set("file", file);
      if (tenantId) fd.set("tenantId", tenantId);
      const res = await fetch("/api/import/csv", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setResult({
          ok: false,
          message: String(json?.error || "No se pudo importar el archivo."),
          details: Array.isArray(json?.errors) ? json.errors.map(String) : undefined
        });
        return;
      }
      const imported = Number(json.imported || 0);
      const failed = Number(json.failed || 0);
      const message = `Importación finalizada. Creados: ${imported}. Fallidos: ${failed}.`;
      setResult({
        ok: true,
        message,
        details: Array.isArray(json?.errors) ? json.errors.map(String) : undefined
      });
      setFile(null);
    } catch {
      setResult({ ok: false, message: "Error de red al importar el CSV." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="filtersRight list-csv-actions">
        <button className="ghost btn-compact btn-icon-only btn-noicon btn-import" type="button" onClick={() => setOpen(true)} aria-label="Importar CSV" title="Importar CSV">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2a.75.75 0 0 1 .75.75v6.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V2.75A.75.75 0 0 1 8 2z"/>
            <path d="M2 10.75A2.75 2.75 0 0 1 4.75 8h6.5A2.75 2.75 0 0 1 14 10.75v2.5A2.75 2.75 0 0 1 11.25 16h-6.5A2.75 2.75 0 0 1 2 13.25v-2.5zm2.75-1.25A1.25 1.25 0 0 0 3.5 10.75v2.5A1.25 1.25 0 0 0 4.75 14.5h6.5a1.25 1.25 0 0 0 1.25-1.25v-2.5a1.25 1.25 0 0 0-1.25-1.25h-6.5z"/>
          </svg>
        </button>
        <a className="ghost btn-compact btn-icon-only btn-noicon btn-export" href={exportHref} aria-label="Exportar CSV" title="Exportar CSV" data-loader="off">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 14a.75.75 0 0 0 .75-.75V7.06l2.22 2.22a.75.75 0 1 0 1.06-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 0 0 1.06 1.06l2.22-2.22v6.19A.75.75 0 0 0 8 14z"/>
            <path d="M2 2.75A2.75 2.75 0 0 1 4.75 0h6.5A2.75 2.75 0 0 1 14 2.75v2.5A2.75 2.75 0 0 1 11.25 8h-6.5A2.75 2.75 0 0 1 2 5.25v-2.5zm2.75-1.25A1.25 1.25 0 0 0 3.5 2.75v2.5A1.25 1.25 0 0 0 4.75 6.5h6.5a1.25 1.25 0 0 0 1.25-1.25v-2.5A1.25 1.25 0 0 0 11.25 1.5h-6.5z"/>
          </svg>
        </a>
      </div>

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(640px, 96vw)" }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Importar datos en CSV</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>

            <form onSubmit={onUpload} className="import-modal-grid">
              <div className="field">
                <label>Tipo de importación</label>
                <select className="select" value={entity} onChange={(e) => setEntity(e.target.value as EntityType)}>
                  <option value="customers">Contactos</option>
                  <option value="products">Productos</option>
                </select>
              </div>

              <div className="field">
                <label>Plantilla CSV</label>
                <div className="field-hint">Descarga la plantilla y usa exactamente las columnas del archivo.</div>
                <a className="ghost btn-compact btn-noicon btn-export" href={templateHref} data-loader="off">
                  Descargar plantilla
                </a>
              </div>

              <div className="field">
                <label>Archivo CSV</label>
                <input
                  className="input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  required
                />
              </div>

              {result ? (
                <div className={`field-hint ${result.ok ? "import-ok" : "import-error"}`}>
                  {result.message}
                  {result.details?.length ? (
                    <ul className="import-error-list">
                      {result.details.slice(0, 12).map((line, idx) => (
                        <li key={`${idx}-${line}`}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost btn-cancel" type="button" onClick={() => setOpen(false)}>
                  Cerrar
                </button>
                <button className="primary btn-import" type="submit" disabled={uploading}>
                  {uploading ? "Importando..." : "Importar CSV"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
