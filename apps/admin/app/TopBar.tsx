"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Header = { title: string; subtitle: string };

function getHeader(pathname: string): Header {
  if (pathname === "/") return { title: "Métricas", subtitle: "Visibilidad operativa en tiempo real." };
  if (pathname.startsWith("/logs")) return { title: "Logs de API", subtitle: "Seguimiento de procesos y sincronizaciones." };
  if (pathname.startsWith("/customers")) return { title: "Contactos", subtitle: "Clientes y datos de contacto." };
  if (pathname.startsWith("/products")) return { title: "Productos y Servicios", subtitle: "Catálogo para cobranza recurrente." };
  if (pathname.startsWith("/billing")) return { title: "Planes y Suscripciones", subtitle: "Cobranza recurrente y ciclos." };
  if (pathname.startsWith("/subscriptions")) return { title: "Suscripciones", subtitle: "Cobros, ciclos y links de pago." };
  if (pathname.startsWith("/plans")) return { title: "Planes", subtitle: "Tipos de suscripción: precio y periodicidad." };
  if (pathname.startsWith("/webhooks")) return { title: "Webhooks", subtitle: "Eventos entrantes y su estado." };
  if (pathname.startsWith("/settings")) return { title: "Configuración", subtitle: "Credenciales y conexiones." };
  if (pathname.startsWith("/__sa")) return { title: "Super Admin", subtitle: "Planes, módulos y consumos." };
  return { title: "Panel", subtitle: "—" };
}

export function TopBar() {
  const pathname = usePathname() || "/";
  const header = useMemo(() => getHeader(pathname), [pathname]);
  const isSuperAdmin = pathname.startsWith("/__sa");

  return (
    <header className="topbar" aria-label="Topbar">
      <div className="topbarLeft">
        <div className="topbarLeftRow">
          <Link href="/" className="topbarLogoLink" prefetch={false} aria-label="Ir al home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-horizontal.png" alt="Suscripciones" className="topbarLogo" />
          </Link>
          <div style={{ display: "grid" }}>
            <h1>{header.title}</h1>
            <div className="subtitle">{header.subtitle}</div>
          </div>
        </div>
      </div>

      <div className="topbarRight" aria-label="Usuario">
        {isSuperAdmin ? (
          <Link href="/__sa/logout" prefetch={false} className="ghost" aria-label="Salir de Super Admin" title="Salir de Super Admin">
            Salir
          </Link>
        ) : null}
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
