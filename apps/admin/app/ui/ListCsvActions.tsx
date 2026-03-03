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
        <button className="ghost btn-compact btn-icon-only btn-import" type="button" onClick={() => setOpen(true)} aria-label="Importar CSV" title="Importar CSV" />
        <a className="ghost btn-compact btn-icon-only btn-export" href={exportHref} aria-label="Exportar CSV" title="Exportar CSV" data-loader="off" />
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
                <a className="ghost btn-compact btn-export" href={templateHref} data-loader="off">
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
