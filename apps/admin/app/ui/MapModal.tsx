"use client";

import { useEffect, useState } from "react";
import { AppModal } from "./AppModal";
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
      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        title={
          <div>
            <div className="panel-title">Ubicación del cliente</div>
            <div className="panel-sub">{label || "Coordenadas registradas"}</div>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <LeafletMap lat={lat} lon={lon} label={label} />
          {mapLink ? (
            <a className="ghost btn-compact" href={mapLink} target="_blank" rel="noreferrer" data-loader="off">
              Abrir en OpenStreetMap
            </a>
          ) : null}
        </div>
      </AppModal>
    </>
  );
}
