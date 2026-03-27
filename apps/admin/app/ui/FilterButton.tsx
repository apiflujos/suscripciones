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
        className="ghost btn-compact btn-icon-only btn-noicon filter-button"
        type="button"
        onClick={() => {
          setOpen(!open);
          onClick?.();
        }}
        aria-label={label}
        title={label}
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M.5 2a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 .56 1.247l-5.06 5.62v4.633a.75.75 0 0 1-1.083.67l-3-1.5a.75.75 0 0 1-.417-.67V8.117l-5.06-5.62A.75.75 0 0 1 .5 2z"/>
        </svg>
      </button>
      
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
