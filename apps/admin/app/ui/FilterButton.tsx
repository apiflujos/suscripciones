"use client";

import { useState } from "react";

export function FilterButton({
  scope,
  baseParams,
  initialFields,
  compactInline
}: {
  scope?: string;
  baseParams?: Record<string, string>;
  initialFields?: any[];
  compactInline?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Si no hay scope, solo es un botón placeholder
  if (!scope) {
    return (
      <button
        className="ghost btn-compact btn-icon-only btn-filter"
        type="button"
        aria-label="Filtros"
        title="Filtros"
        disabled
      />
    );
  }

  return (
    <>
      <button
        className="ghost btn-compact btn-icon-only btn-filter"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Crear filtro inteligente"
        title="Crear filtro inteligente"
      />

      {open && (
        <div className="modal-backdrop">
          <div className="modal-panel modal-panel-fixed smartViewsModalPanel" style={{ width: "min(900px, 96vw)", maxHeight: "90vh" }}>
            <div className="panel-header">
              <strong>Crear filtro inteligente</strong>
              <button
                className="ghost modal-close"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                data-modal-close="true"
                data-loader="off"
              >
                X
              </button>
            </div>
            <div className="modal-body smartViewsModalBody">
              <p className="muted" style={{ marginBottom: 16 }}>
                Crea reglas personalizadas para filtrar los registros. Una vez guardado, el filtro aparecerá en la barra de vistas inteligentes.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  className="ghost btn-compact btn-cancel"
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Cancelar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <button
                  className="primary btn-compact btn-save"
                  type="button"
                  onClick={() => {
                    // Aquí iría la lógica para guardar el filtro
                    // Por ahora solo cerramos el modal
                    setOpen(false);
                    // Disparar evento para que SmartViewsBar recargue
                    window.dispatchEvent(new CustomEvent("smartview-created"));
                  }}
                  title="Guardar filtro"
                  aria-label="Guardar"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
