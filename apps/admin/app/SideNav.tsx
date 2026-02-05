"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function isActivePath(currentPath: string, href: string) {
  if (href === "/") return currentPath === "/";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

function NavIcon({
  name,
  className
}: {
  name: "metrics" | "contacts" | "products" | "billing" | "logs" | "settings";
  className?: string;
}) {
  if (name === "metrics") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M8 17V9" />
        <path d="M12 17V7" />
        <path d="M16 17v-5" />
      </svg>
    );
  }
  if (name === "contacts") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      </svg>
    );
  }
  if (name === "products") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M7 7h10v10H7z" />
        <path d="M4 4h4" />
        <path d="M16 4h4" />
        <path d="M4 20h4" />
        <path d="M16 20h4" />
      </svg>
    );
  }
  if (name === "billing") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M7 4h10v16H7z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </svg>
    );
  }
  if (name === "logs") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 4h16v16H4z" />
        <path d="M8 8h8" />
        <path d="M8 12h8" />
        <path d="M8 16h6" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.06.06a2.2 2.2 0 0 1-1.56 3.76 2.2 2.2 0 0 1-1.56-.64l-.06-.06a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1 1.64V22a2.2 2.2 0 0 1-4.4 0v-.08a1.8 1.8 0 0 0-1-1.64 1.8 1.8 0 0 0-2 .36l-.06.06a2.2 2.2 0 0 1-3.12 0 2.2 2.2 0 0 1 0-3.12l.06-.06a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.64-1H2a2.2 2.2 0 0 1 0-4.4h.08a1.8 1.8 0 0 0 1.64-1 1.8 1.8 0 0 0-.36-2l-.06-.06a2.2 2.2 0 0 1 0-3.12 2.2 2.2 0 0 1 3.12 0l.06.06a1.8 1.8 0 0 0 2 .36 1.8 1.8 0 0 0 1-1.64V2a2.2 2.2 0 0 1 4.4 0v.08a1.8 1.8 0 0 0 1 1.64 1.8 1.8 0 0 0 2-.36l.06-.06a2.2 2.2 0 0 1 3.12 0 2.2 2.2 0 0 1 0 3.12l-.06.06a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.64 1H22a2.2 2.2 0 0 1 0 4.4h-.08a1.8 1.8 0 0 0-1.64 1Z" />
    </svg>
  );
}

export function SideNav() {
  const pathname = usePathname() || "";

  return (
    <nav className="nav" aria-label="Navegación">
      <Link
        className={`nav-item ${isActivePath(pathname, "/") ? "is-active" : ""}`}
        href="/"
        aria-current={isActivePath(pathname, "/") ? "page" : undefined}
      >
        <NavIcon name="metrics" className="nav-icon" />
        <span className="nav-label">Métricas</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/customers") ? "is-active" : ""}`}
        href="/customers"
        aria-current={isActivePath(pathname, "/customers") ? "page" : undefined}
      >
        <NavIcon name="contacts" className="nav-icon" />
        <span className="nav-label">Contactos</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/products") ? "is-active" : ""}`}
        href="/products"
        aria-current={isActivePath(pathname, "/products") ? "page" : undefined}
      >
        <NavIcon name="products" className="nav-icon" />
        <span className="nav-label">Productos y Servicios</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/billing") ? "is-active" : ""}`}
        href="/billing"
        aria-current={isActivePath(pathname, "/billing") ? "page" : undefined}
      >
        <NavIcon name="billing" className="nav-icon" />
        <span className="nav-label">Planes y Suscripciones</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/logs") ? "is-active" : ""}`}
        href="/logs"
        aria-current={isActivePath(pathname, "/logs") ? "page" : undefined}
      >
        <NavIcon name="logs" className="nav-icon" />
        <span className="nav-label">Logs de API</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/settings") ? "is-active" : ""}`}
        href="/settings"
        aria-current={isActivePath(pathname, "/settings") ? "page" : undefined}
      >
        <NavIcon name="settings" className="nav-icon" />
        <span className="nav-label">Configuración</span>
      </Link>
    </nav>
  );
}
