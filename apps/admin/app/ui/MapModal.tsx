"use client";

import { useEffect, useState } from "react";
import { LeafletMap } from "./LeafletMap";

export function MapModal({
  lat,
  lon,
  label,
  mapLink,
  triggerLabel = "Ver mapa",
  triggerClassName
}: {
  lat: number;
  lon: number;
  label?: string;
  mapLink?: string;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className={triggerClassName || "ghost btn-compact"} onClick={() => setOpen(true)} data-loader="off">
        {triggerLabel}
      </button>
      {open ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <div className="panel-title">Ubicación del cliente</div>
                <div className="panel-sub">{label || "Coordenadas registradas"}</div>
              </div>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-loader="off" />
            </div>
            <div className="modal-body" style={{ display: "grid", gap: 12 }}>
              <LeafletMap lat={lat} lon={lon} label={label} />
              {mapLink ? (
                <a className="ghost btn-compact" href={mapLink} target="_blank" rel="noreferrer" data-loader="off">
                  Abrir en OpenStreetMap
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
