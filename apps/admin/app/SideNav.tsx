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
    <nav className="nav" aria-label="Navegación">
      <Link className={`nav-item ${isActivePath(pathname, "/") ? "is-active" : ""}`} href="/">
        <span className="nav-label">Métricas</span>
      </Link>
      <Link className={`nav-item ${isActivePath(pathname, "/plans") ? "is-active" : ""}`} href="/plans">
        <span className="nav-label">Productos</span>
      </Link>
      <Link className={`nav-item ${isActivePath(pathname, "/customers") ? "is-active" : ""}`} href="/customers">
        <span className="nav-label">Contactos</span>
      </Link>
      <Link className={`nav-item ${isActivePath(pathname, "/subscriptions") ? "is-active" : ""}`} href="/subscriptions">
        <span className="nav-label">Suscripciones</span>
      </Link>
      <Link className={`nav-item ${isActivePath(pathname, "/webhooks") ? "is-active" : ""}`} href="/webhooks">
        <span className="nav-label">Webhooks</span>
      </Link>
      <Link className={`nav-item ${isActivePath(pathname, "/logs") ? "is-active" : ""}`} href="/logs">
        <span className="nav-label">Logs de API</span>
      </Link>
      <Link className={`nav-item ${isActivePath(pathname, "/settings") ? "is-active" : ""}`} href="/settings">
        <span className="nav-label">Configuración</span>
      </Link>
    </nav>
  );
}
