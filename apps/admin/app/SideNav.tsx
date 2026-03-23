"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminSession } from "../lib/session";

const SIDEBAR_COLLAPSED_KEY = "admin.sidebarCollapsed";

function isActivePath(currentPath: string, href: string) {
  if (href === "/") return currentPath === "/";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

function NavIcon({
  name,
  className
}: {
  name: "metrics" | "payments" | "contacts" | "companies" | "products" | "billing" | "checkout" | "notifications" | "logs" | "settings" | "appearance" | "lists" | "campaigns";
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
  if (name === "companies") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 21V7a2 2 0 0 1 2-2h6v16" />
        <path d="M14 21V3h4a2 2 0 0 1 2 2v16" />
        <path d="M8 11h2" />
        <path d="M8 15h2" />
        <path d="M16 11h2" />
        <path d="M16 15h2" />
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
  if (name === "checkout") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 6h15l-1.5 9H7.5L6 6z" />
        <path d="M9 6V4a3 3 0 0 1 6 0v2" />
        <circle cx="9" cy="20" r="1.2" />
        <circle cx="18" cy="20" r="1.2" />
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
  if (name === "notifications") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    );
  }
  if (name === "lists") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <circle cx="4" cy="6" r="1.5" />
        <circle cx="4" cy="12" r="1.5" />
        <circle cx="4" cy="18" r="1.5" />
      </svg>
    );
  }
  if (name === "campaigns") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h10" />
        <path d="M18 16v4" />
        <path d="M16 18h4" />
      </svg>
    );
  }
  if (name === "payments") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h4" />
      </svg>
    );
  }
  if (name === "appearance") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="5" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
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

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function ChevronIcon({ className, direction }: { className?: string; direction: "left" | "right" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {direction === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 2l8 4v6c0 5-3.4 9.4-8 10-4.6-.6-8-5-8-10V6l8-4z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10 17l1 1a2 2 0 0 0 2 0l6-5a2 2 0 0 0 0-2l-6-5a2 2 0 0 0-2 0l-1 1" />
      <path d="M15 12H3" />
    </svg>
  );
}

export function SideNav({ session }: { session: AdminSession | null }) {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const logTab = searchParams?.get("tab") || "";
  const isPaymentsInLogs = pathname === "/logs" && logTab === "payments";
  const isSuperAdminPath = pathname.startsWith("/sa") || pathname.startsWith("/__sa");
  const isSuperAdmin = session?.role === "SUPER_ADMIN";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const shell = document.querySelector(".app-shell") as HTMLElement | null;
    if (!shell) return;

    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    shell.classList.toggle("is-collapsed", stored);
    setCollapsed(stored);

    const computeIsMobile = () => window.innerWidth <= 920;
    setIsMobile(computeIsMobile());

    const onResize = () => {
      const mobile = computeIsMobile();
      setIsMobile(mobile);
      if (!mobile) {
        shell.classList.remove("is-mobile-open");
        setMobileOpen(false);
      }
    };
    window.addEventListener("resize", onResize);

    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.classList.contains("sidebarOverlay")) {
        shell.classList.remove("is-mobile-open");
        setMobileOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      shell.classList.remove("is-mobile-open");
      setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const shell = document.querySelector(".app-shell") as HTMLElement | null;
    if (!shell) return;
    shell.classList.remove("is-mobile-open");
    setMobileOpen(false);
  }, [pathname]);

  function toggleSidebar() {
    const shell = document.querySelector(".app-shell") as HTMLElement | null;
    if (!shell) return;

    if (isMobile) {
      const next = !shell.classList.contains("is-mobile-open");
      shell.classList.toggle("is-mobile-open", next);
      setMobileOpen(next);
      return;
    }

    const next = !shell.classList.contains("is-collapsed");
    shell.classList.toggle("is-collapsed", next);
    setCollapsed(next);
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
  }

  return (
    <div className="sidebarShell">
      <button
        type="button"
        className="sidebarToggleBtn"
        onClick={toggleSidebar}
        aria-label={mobileOpen ? "Cerrar menú" : collapsed ? "Desplegar menú" : "Plegar menú"}
        title={mobileOpen ? "Cerrar menú" : collapsed ? "Desplegar menú" : "Plegar menú"}
        data-loader="off"
      >
        {isMobile ? (
          mobileOpen ? (
            <CloseIcon className="nav-icon" />
          ) : (
            <MenuIcon className="nav-icon" />
          )
        ) : collapsed ? (
          <ChevronIcon className="nav-icon" direction="right" />
        ) : (
          <ChevronIcon className="nav-icon" direction="left" />
        )}
        <span className="nav-label">Menú</span>
        <span className="menuStatusDot" aria-hidden="true" />
      </button>

      <nav className="nav" aria-label="Navegación">
      <Link
        className={`nav-item ${isActivePath(pathname, "/") ? "is-active" : ""}`}
        href="/"
        prefetch={false}
        aria-current={isActivePath(pathname, "/") ? "page" : undefined}
        aria-disabled={isActivePath(pathname, "/") ? "true" : undefined}
        data-loader={isActivePath(pathname, "/") ? "off" : undefined}
        tabIndex={isActivePath(pathname, "/") ? -1 : undefined}
      >
        <NavIcon name="metrics" className="nav-icon" />
        <span className="nav-label">Métricas</span>
      </Link>
      <Link
        className={`nav-item ${(isActivePath(pathname, "/payments") || isPaymentsInLogs) ? "is-active" : ""}`}
        href="/payments"
        prefetch={false}
        aria-current={(isActivePath(pathname, "/payments") || isPaymentsInLogs) ? "page" : undefined}
        aria-disabled={(isActivePath(pathname, "/payments") || isPaymentsInLogs) ? "true" : undefined}
        data-loader={(isActivePath(pathname, "/payments") || isPaymentsInLogs) ? "off" : undefined}
        tabIndex={(isActivePath(pathname, "/payments") || isPaymentsInLogs) ? -1 : undefined}
      >
        <NavIcon name="payments" className="nav-icon" />
        <span className="nav-label">Pagos</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/empresas") ? "is-active" : ""}`}
        href="/empresas"
        prefetch={false}
        aria-current={isActivePath(pathname, "/empresas") ? "page" : undefined}
        aria-disabled={isActivePath(pathname, "/empresas") ? "true" : undefined}
        data-loader={isActivePath(pathname, "/empresas") ? "off" : undefined}
        tabIndex={isActivePath(pathname, "/empresas") ? -1 : undefined}
      >
        <NavIcon name="companies" className="nav-icon" />
        <span className="nav-label">Empresas</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/customers") ? "is-active" : ""}`}
        href="/customers"
        prefetch={false}
        aria-current={isActivePath(pathname, "/customers") ? "page" : undefined}
        aria-disabled={isActivePath(pathname, "/customers") ? "true" : undefined}
        data-loader={isActivePath(pathname, "/customers") ? "off" : undefined}
        tabIndex={isActivePath(pathname, "/customers") ? -1 : undefined}
      >
        <NavIcon name="contacts" className="nav-icon" />
        <span className="nav-label">Contactos</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/products") ? "is-active" : ""}`}
        href="/products"
        prefetch={false}
        aria-current={isActivePath(pathname, "/products") ? "page" : undefined}
        aria-disabled={isActivePath(pathname, "/products") ? "true" : undefined}
        data-loader={isActivePath(pathname, "/products") ? "off" : undefined}
        tabIndex={isActivePath(pathname, "/products") ? -1 : undefined}
      >
        <NavIcon name="products" className="nav-icon" />
        <span className="nav-label">Productos y Servicios</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/billing") ? "is-active" : ""}`}
        href="/billing"
        prefetch={false}
        aria-current={isActivePath(pathname, "/billing") ? "page" : undefined}
        aria-disabled={isActivePath(pathname, "/billing") ? "true" : undefined}
        data-loader={isActivePath(pathname, "/billing") ? "off" : undefined}
        tabIndex={isActivePath(pathname, "/billing") ? -1 : undefined}
      >
        <NavIcon name="billing" className="nav-icon" />
        <span className="nav-label">Suscripciones</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/notifications") ? "is-active" : ""}`}
        href="/notifications"
        prefetch={false}
        aria-current={isActivePath(pathname, "/notifications") ? "page" : undefined}
        aria-disabled={isActivePath(pathname, "/notifications") ? "true" : undefined}
        data-loader={isActivePath(pathname, "/notifications") ? "off" : undefined}
        tabIndex={isActivePath(pathname, "/notifications") ? -1 : undefined}
      >
        <NavIcon name="notifications" className="nav-icon" />
        <span className="nav-label">Notificaciones WhatsApp</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/smart-lists") ? "is-active" : ""}`}
        href="/smart-lists"
        prefetch={false}
        aria-current={isActivePath(pathname, "/smart-lists") ? "page" : undefined}
        aria-disabled={isActivePath(pathname, "/smart-lists") ? "true" : undefined}
        data-loader={isActivePath(pathname, "/smart-lists") ? "off" : undefined}
        tabIndex={isActivePath(pathname, "/smart-lists") ? -1 : undefined}
      >
        <NavIcon name="lists" className="nav-icon" />
        <span className="nav-label">Gamificación</span>
      </Link>
      <Link
        className={`nav-item ${isActivePath(pathname, "/campaigns") ? "is-active" : ""}`}
        href="/campaigns"
        prefetch={false}
        aria-current={isActivePath(pathname, "/campaigns") ? "page" : undefined}
        aria-disabled={isActivePath(pathname, "/campaigns") ? "true" : undefined}
        data-loader={isActivePath(pathname, "/campaigns") ? "off" : undefined}
        tabIndex={isActivePath(pathname, "/campaigns") ? -1 : undefined}
      >
        <NavIcon name="campaigns" className="nav-icon" />
        <span className="nav-label">Mensajes masivos</span>
      </Link>
      {isSuperAdmin ? (
        <Link
          className={`nav-item ${(isActivePath(pathname, "/logs") && !isPaymentsInLogs) ? "is-active" : ""}`}
          href="/logs"
          prefetch={false}
          aria-current={(isActivePath(pathname, "/logs") && !isPaymentsInLogs) ? "page" : undefined}
          aria-disabled={(isActivePath(pathname, "/logs") && !isPaymentsInLogs) ? "true" : undefined}
          data-loader={(isActivePath(pathname, "/logs") && !isPaymentsInLogs) ? "off" : undefined}
          tabIndex={(isActivePath(pathname, "/logs") && !isPaymentsInLogs) ? -1 : undefined}
        >
          <NavIcon name="logs" className="nav-icon" />
          <span className="nav-label">Logs de API</span>
        </Link>
      ) : null}
      {session?.role !== "AGENT" ? (
        <Link
          className={`nav-item ${isActivePath(pathname, "/settings") ? "is-active" : ""}`}
          href="/settings"
          prefetch={false}
          aria-current={isActivePath(pathname, "/settings") ? "page" : undefined}
          aria-disabled={isActivePath(pathname, "/settings") ? "true" : undefined}
          data-loader={isActivePath(pathname, "/settings") ? "off" : undefined}
          tabIndex={isActivePath(pathname, "/settings") ? -1 : undefined}
        >
          <NavIcon name="settings" className="nav-icon" />
          <span className="nav-label">Configuración</span>
        </Link>
      ) : null}
      {isSuperAdmin ? (
        <Link
          className={`nav-item ${isSuperAdminPath ? "is-active" : ""}`}
          href="/sa"
          prefetch={false}
          aria-current={isSuperAdminPath ? "page" : undefined}
          aria-disabled={isSuperAdminPath ? "true" : undefined}
          data-loader={isSuperAdminPath ? "off" : undefined}
          tabIndex={isSuperAdminPath ? -1 : undefined}
        >
          <ShieldIcon className="nav-icon" />
          <span className="nav-label">Super Admin</span>
        </Link>
      ) : null}
      </nav>

      <div className="sidebarSpacer" />

      <a className="sidebarExit" href="/logout" aria-label="Salir" title="Salir">
        <LogoutIcon className="nav-icon" />
        <span className="nav-label">Salir</span>
      </a>
    </div>
  );
}
