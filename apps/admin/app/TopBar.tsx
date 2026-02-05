"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

type Header = { title: string; subtitle: string };

function getHeader(pathname: string): Header {
  if (pathname === "/") return { title: "Metricas Olivia Shoes", subtitle: "Visibilidad operativa en tiempo real." };
  if (pathname.startsWith("/logs")) return { title: "Logs de API", subtitle: "Seguimiento de procesos y sincronizaciones." };
  if (pathname.startsWith("/customers")) return { title: "Contactos", subtitle: "Clientes y datos de contacto." };
  if (pathname.startsWith("/products")) return { title: "Productos y Servicios", subtitle: "Inventario + planes y suscripciones." };
  if (pathname.startsWith("/subscriptions")) return { title: "Suscripciones", subtitle: "Cobros, ciclos y links de pago." };
  if (pathname.startsWith("/plans")) return { title: "Planes", subtitle: "Tipos de suscripción: precio y periodicidad." };
  if (pathname.startsWith("/webhooks")) return { title: "Webhooks", subtitle: "Eventos entrantes y su estado." };
  if (pathname.startsWith("/settings")) return { title: "Configuración", subtitle: "Credenciales y conexiones." };
  return { title: "Panel", subtitle: "—" };
}

export function TopBar() {
  const pathname = usePathname() || "/";
  const header = useMemo(() => getHeader(pathname), [pathname]);

  return (
    <header className="topbar" aria-label="Topbar">
      <div className="topbarLeft">
        <h1>{header.title}</h1>
        <div className="subtitle">{header.subtitle}</div>
      </div>

      <div className="topbarCenter" aria-label="Marca">
        <div className="brandPill">
          <span className="brandMark" aria-hidden="true">
            A
          </span>
          <span style={{ fontWeight: 800 }}>ApiFlujos</span>
        </div>
      </div>

      <div className="topbarRight" aria-label="Usuario">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/avatar.png" alt="" className="userAvatar" />
        <div style={{ display: "grid", lineHeight: 1.1 }}>
          <div style={{ fontWeight: 700 }}>Sebastian</div>
          <div className="subtitle" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Admin
          </div>
        </div>
      </div>
    </header>
  );
}
