"use client";

import { useEffect, useRef, useState } from "react";
import { LeafletMap } from "../ui/LeafletMap";
import "./customers.css";

/**
 * Ubicación del contacto: el mapa va dentro de la página, en una sección plegable
 * (antes era el modal "Ubicación del cliente"). El mapa se monta al abrir, para que
 * Leaflet mida un contenedor visible.
 */
export function LocationSection({
  lat,
  lon,
  label,
  mapLink
}: {
  lat: number;
  lon: number;
  label?: string;
  mapLink?: string;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const [open, setOpen] = useState(false);

  // El enlace "Ubicación" de la cabecera apunta a #ubicacion: abre la sección.
  useEffect(() => {
    const openIfHash = () => {
      if (window.location.hash === "#ubicacion" && ref.current) {
        ref.current.open = true;
        setOpen(true);
      }
    };
    openIfHash();
    window.addEventListener("hashchange", openIfHash);
    return () => window.removeEventListener("hashchange", openIfHash);
  }, []);

  return (
    <details ref={ref} className="customers-location" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Ver mapa{label ? ` · ${label}` : ""}</summary>
      <div className="customers-location-body">
        {open ? (
          <div className="customers-map">
            <LeafletMap lat={lat} lon={lon} label={label} />
          </div>
        ) : null}
        {mapLink ? (
          <div>
            <a className="ghost btn-compact" href={mapLink} target="_blank" rel="noreferrer" data-loader="off">
              Abrir en OpenStreetMap
            </a>
          </div>
        ) : null}
      </div>
    </details>
  );
}
