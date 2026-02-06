"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Header = { title: string; subtitle: string };

const SIDEBAR_COLLAPSED_KEY = "admin.sidebarCollapsed";

function getHeader(pathname: string): Header {
  if (pathname === "/") return { title: "Metricas Olivia Shoes", subtitle: "Visibilidad operativa en tiempo real." };
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

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 4h6v16H4z" />
      <path d="M14 12h6" />
      <path d="M16 8l-4 4 4 4" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 4h6v16H4z" />
      <path d="M14 12h6" />
      <path d="M14 8l4 4-4 4" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10 17l1 1a2 2 0 0 0 2 0l6-5a2 2 0 0 0 0-2l-6-5a2 2 0 0 0-2 0l-1 1" />
      <path d="M15 12H3" />
    </svg>
  );
}

export function TopBar() {
  const pathname = usePathname() || "/";
  const header = useMemo(() => getHeader(pathname), [pathname]);
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
      if (window.innerWidth > 920) {
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
    <header className="topbar" aria-label="Topbar">
      <div className="topbarLeft">
        <div className="topbarLeftRow">
          <button
            type="button"
            className="iconBtn"
            onClick={toggleSidebar}
            aria-label={mobileOpen ? "Cerrar menú" : collapsed ? "Desplegar menú" : "Plegar menú"}
            title={mobileOpen ? "Cerrar menú" : collapsed ? "Desplegar menú" : "Plegar menú"}
          >
            {isMobile ? <MenuIcon /> : collapsed ? <ExpandIcon /> : <CollapseIcon />}
          </button>
          <div style={{ display: "grid" }}>
            <h1>{header.title}</h1>
            <div className="subtitle">{header.subtitle}</div>
          </div>
        </div>
      </div>

      <div className="topbarCenter" aria-label="Marca">
        <Link href="/" className="topbarLogoLink" prefetch={false} aria-label="Ir al home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-horizontal.png" alt="Suscripciones" className="topbarLogo" />
        </Link>
      </div>

      <div className="topbarRight" aria-label="Usuario">
        {pathname.startsWith("/__sa") ? (
          <a className="iconBtn" href="/__sa/logout" aria-label="Salir" title="Salir">
            <LogoutIcon />
          </a>
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
