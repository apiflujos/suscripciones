"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

type LeafletMapProps = {
  lat: number;
  lon: number;
  label?: string;
};

const defaultMarkerIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});

export function LeafletMap({ lat, lon, label }: LeafletMapProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const center: L.LatLngExpression = [lat, lon];
    const map = L.map(mapNodeRef.current, {
      center,
      zoom: 15,
      scrollWheelZoom: false,
      zoomControl: false
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    const marker = L.marker(center, { icon: defaultMarkerIcon }).addTo(map);
    if (label) marker.bindPopup(label);

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lon, label]);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;

    const center: L.LatLngExpression = [lat, lon];
    mapRef.current.setView(center, mapRef.current.getZoom(), { animate: false });
    markerRef.current.setLatLng(center);

    if (label) {
      markerRef.current.bindPopup(label);
    } else {
      markerRef.current.unbindPopup();
    }
  }, [lat, lon, label]);

  return <div ref={mapNodeRef} className="leaflet-map" />;
}
