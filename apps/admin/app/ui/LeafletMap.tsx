"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, ZoomControl } from "react-leaflet";
import L from "leaflet";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

type LeafletMapProps = {
  lat: number;
  lon: number;
  label?: string;
};

export function LeafletMap({ lat, lon, label }: LeafletMapProps) {
  useEffect(() => {
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: (markerIcon2x as any).src || markerIcon2x,
      iconUrl: (markerIcon as any).src || markerIcon,
      shadowUrl: (markerShadow as any).src || markerShadow
    });
  }, []);

  const center = useMemo<[number, number]>(() => [lat, lon], [lat, lon]);

  return (
    <MapContainer center={center} zoom={15} scrollWheelZoom={false} className="leaflet-map" zoomControl={false}>
      <ZoomControl position="bottomright" />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={center}>
        {label ? <Popup>{label}</Popup> : null}
      </Marker>
    </MapContainer>
  );
}
