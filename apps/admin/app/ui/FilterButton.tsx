"use client";

import { useState } from "react";

export function FilterButton({
  onClick,
  label = "Filtros"
}: {
  onClick?: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="filterButtonWrapper" style={{ position: "relative" }}>
      <button
        className="ghost btn-compact btn-icon-only btn-filter"
        type="button"
        onClick={() => {
          setOpen(!open);
          onClick?.();
        }}
        aria-label={label}
        title={label}
        aria-expanded={open}
      />
      
      {open && (
        <div className="filter-dropdown">
          <div className="filter-dropdown-header">
            <strong>Filtros inteligentes</strong>
            <button
              className="ghost btn-compact btn-icon-only btn-noicon"
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M14 1.41L12.59 0 7 5.59 1.41 0 0 1.41 5.59 7 0 12.59 1.41 14 7 8.41 12.59 14 14 12.59 8.41 7z"/>
              </svg>
            </button>
          </div>
          <div className="filter-dropdown-body">
            <p className="filter-dropdown-hint">
              Crea filtros personalizados para mostrar solo los registros que necesitas.
            </p>
            <button
              className="primary btn-compact btn-noicon"
              type="button"
              onClick={() => {
                setOpen(false);
                onClick?.();
              }}
            >
              Crear filtro
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
