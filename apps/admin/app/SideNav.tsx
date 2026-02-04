"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function isActivePath(currentPath: string, href: string) {
  if (href === "/") return currentPath === "/";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export function SideNav() {
  const pathname = usePathname() || "";

  return (
    <nav className="sideNav" aria-label="Navegación">
      <Link className={`sideLink ${isActivePath(pathname, "/") ? "sideLinkActive" : ""}`} href="/">
        Métricas
      </Link>
      <Link className={`sideLink ${isActivePath(pathname, "/plans") ? "sideLinkActive" : ""}`} href="/plans">
        Productos
      </Link>
      <Link className={`sideLink ${isActivePath(pathname, "/customers") ? "sideLinkActive" : ""}`} href="/customers">
        Contactos
      </Link>
      <Link className={`sideLink ${isActivePath(pathname, "/subscriptions") ? "sideLinkActive" : ""}`} href="/subscriptions">
        Suscripciones
      </Link>
      <Link className={`sideLink ${isActivePath(pathname, "/bodegas") ? "sideLinkActive" : ""}`} href="/bodegas">
        Bodegas
      </Link>
      <Link className={`sideLink ${isActivePath(pathname, "/webhooks") ? "sideLinkActive" : ""}`} href="/webhooks">
        Webhooks
      </Link>
      <Link className={`sideLink ${isActivePath(pathname, "/logs") ? "sideLinkActive" : ""}`} href="/logs">
        Logs de API
      </Link>
      <Link className={`sideLink ${isActivePath(pathname, "/settings") ? "sideLinkActive" : ""}`} href="/settings">
        Configuración
      </Link>
    </nav>
  );
}

