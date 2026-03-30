"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminSession } from "../lib/session";
import { getFilterIcon, getNotificationColor, getNotificationIcon, resolveNotificationHref, useNotificationsFeed } from "./ui/notificationsFeed";
import type { NotificationItem } from "./ui/notificationsFeed";

type Header = { title: string; subtitle: string };

type HeaderNotification = NotificationItem;

function getHeader(pathname: string): Header {
  if (pathname === "/") return { title: "Métricas", subtitle: "Ajusta rango y granularidad para leer la evolución de las métricas." };
  if (pathname.startsWith("/payments")) return { title: "Pagos", subtitle: "Seguimiento de pagos, estados y conciliación." };
  if (pathname.startsWith("/logs")) return { title: "Logs de API", subtitle: "Seguimiento de procesos y sincronizaciones." };
  if (pathname.startsWith("/customers")) return { title: "Contactos", subtitle: "Clientes y datos de contacto." };
  if (pathname.startsWith("/empresas") || pathname.startsWith("/dashboard/empresas")) {
    return { title: "Empresas", subtitle: "Gestión de empresas y contactos asociados." };
  }
  if (pathname.startsWith("/products")) return { title: "Productos y Servicios", subtitle: "Catálogo para cobranza recurrente." };
  if (pathname.startsWith("/billing")) return { title: "Suscripciones", subtitle: "Cobranza recurrente y ciclos." };
  if (pathname.startsWith("/subscriptions")) return { title: "Suscripciones", subtitle: "Cobros, ciclos y links de pago." };
  if (pathname.startsWith("/plans")) return { title: "Planes", subtitle: "Tipos de suscripción: precio y periodicidad." };
  if (pathname.startsWith("/notifications")) return { title: "Notificaciones WhatsApp", subtitle: "Plantillas, reglas y recordatorios." };
  if (pathname.startsWith("/campaigns")) return { title: "Mensajes masivos", subtitle: "Envíos por audiencia con filtros inteligentes." };
  if (pathname.startsWith("/webhooks")) return { title: "Webhooks", subtitle: "Eventos entrantes y su estado." };
  if (pathname.startsWith("/settings")) return { title: "Configuración", subtitle: "Credenciales y conexiones." };
  if (pathname.startsWith("/appearance")) return { title: "Apariencia", subtitle: "Tema, visión y contraste." };
  if (pathname.startsWith("/sa") || pathname.startsWith("/__sa")) return { title: "Super Admin", subtitle: "Planes, módulos, usuarios y consumos." };
  return { title: "Panel", subtitle: "—" };
}

function UserMenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function BellIcon({ className, animated }: { className?: string; animated?: boolean }) {
  return (
    <svg className={`${className} ${animated ? "bell-shake" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M15 17H5l2-2v-4a5 5 0 1 1 10 0v4l2 2h-4" />
      <path d="M10 17a2 2 0 0 0 4 0" />
    </svg>
  );
}

function displayNameFromEmail(email: string) {
  const e = String(email || "").trim();
  if (!e) return "Usuario";
  const local = e.split("@")[0] || e;
  return local.slice(0, 1).toUpperCase() + local.slice(1);
}

export function TopBar({ session }: { session: AdminSession | null }) {
  const pathname = usePathname() || "";
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const currentPath = mounted ? pathname : "";
  const header = useMemo(() => getHeader(currentPath || "/"), [currentPath]);
  const isSuperAdmin = session?.role === "SUPER_ADMIN";
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [paymentPulse, setPaymentPulse] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const pulseRef = useRef<NodeJS.Timeout | null>(null);
  const {
    filteredNotifications,
    filter,
    setFilter,
    filterOptions,
    unreadCount,
    markNotification,
    markAll,
    clearAll
  } = useNotificationsFeed({ isSuperAdmin });

  const triggerPaymentPulse = () => {
    setPaymentPulse(true);
    if (pulseRef.current) clearTimeout(pulseRef.current);
    pulseRef.current = setTimeout(() => setPaymentPulse(false), 2200);
  };

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current && menuRef.current.contains(t)) return;
      if (notifRef.current && notifRef.current.contains(t)) return;
      setMenuOpen(false);
      setNotifOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const onPayment = () => triggerPaymentPulse();
    window.addEventListener("apiflujos:payment-approved", onPayment);
    return () => {
      window.removeEventListener("apiflujos:payment-approved", onPayment);
      if (pulseRef.current) clearTimeout(pulseRef.current);
    };
  }, []);

  const resolveContactPayload = (meta: any) => {
    if (!meta || typeof meta !== "object") return null;
    const name = String(meta.customerName || meta.name || meta.customer || "").trim();
    const email = String(meta.customerEmail || meta.email || "").trim();
    const phone = String(meta.customerPhone || meta.phone || "").trim();
    const tenantId = String(meta.tenantId || "").trim();
    if (!name || !email || !phone) return null;
    return { name, email, phone, tenantId: tenantId || undefined };
  };

  const canCreateContact = (n: HeaderNotification) => {
    if (n.category !== "clientes" && n.category !== "pagos") return false;
    return Boolean(resolveContactPayload(n.meta));
  };

  const [creatingContactId, setCreatingContactId] = useState<string | null>(null);

  const createContactFromNotification = async (n: HeaderNotification) => {
    const payload = resolveContactPayload(n.meta);
    if (!payload) return;
    try {
      setCreatingContactId(n.id);
      const res = await fetch("/api/customers/create-from-notification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        console.warn("create_contact_failed", json?.error || res.status);
        return;
      }
      markNotification(n.id, true);
      if (json?.customerId) {
        window.location.href = `/customers/${encodeURIComponent(json.customerId)}`;
      }
    } catch (err) {
      console.warn("create_contact_failed", err);
    } finally {
      setCreatingContactId((prev) => (prev === n.id ? null : prev));
    }
  };

  return (
    <header className="topbar" aria-label="Topbar" suppressHydrationWarning>
      <div className="topbarLeft">
        <div className="topbarLeftRow">
          <Link href="/" className="topbarLogoLink" prefetch={false} aria-label="Ir al home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo_horizontal.svg" alt="Logo" className="topbarLogo" data-theme-logo="horizontal" />
            <span className="logoStatusDot" aria-hidden="true" />
          </Link>
        </div>
        <div className="topbarTitleCentered">
          <h1 className="topbarTitle" suppressHydrationWarning>{header.title}</h1>
          <div className="topbarSubtitle" suppressHydrationWarning>{header.subtitle}</div>
        </div>
        <div className={`topbarPulse ${paymentPulse ? "is-active" : ""}`} aria-live="polite">
          <span className="topbarPulseDot" aria-hidden="true" />
          <span className="topbarPulseText">Pago recibido</span>
        </div>
      </div>

      <div className="topbarRight" aria-label="Usuario">
        <div className="userMenu" ref={menuRef}>
          <button
            type="button"
            className="userMenuBtn"
            data-loader="off"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Abrir menú de usuario"
            aria-haspopup="menu"
            aria-expanded={menuOpen ? "true" : "false"}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/avatar.png" alt="" className="userAvatar" />
            <div style={{ display: "grid", lineHeight: 1.1, textAlign: "left" }}>
              <div style={{ fontWeight: 700 }}>{displayNameFromEmail(session?.email || "")}</div>
              <div className="subtitle" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {session?.role || "—"}
              </div>
            </div>
            <UserMenuIcon className="userMenuIcon" />
          </button>

          {menuOpen ? (
            <div className="userMenuPopover" role="menu" aria-label="Menú de usuario">
              <Link className="userMenuItem" href="/appearance" prefetch={false} role="menuitem">
                Apariencia
              </Link>
              <Link className="userMenuItem" href="/settings" prefetch={false} role="menuitem">
                Configuración
              </Link>
              {isSuperAdmin ? (
                <>
                  <Link className="userMenuItem" href="/sa" prefetch={false} role="menuitem">
                    Super Admin
                  </Link>
                  <Link className="userMenuItem" href="/sa/users" prefetch={false} role="menuitem">
                    Usuarios
                  </Link>
                </>
              ) : null}
              <Link className="userMenuItem isDanger" href="/logout" prefetch={false} role="menuitem">
                Salir
              </Link>
            </div>
          ) : null}
        </div>
        
        {/* Campana de notificaciones MEJORADA */}
        <div className="topbarNotifications" ref={notifRef}>
          <button
            type="button"
            className={`topbarBellBtn ${unreadCount > 0 ? "has-unread" : ""}`}
            data-loader="off"
            onClick={() => setNotifOpen((v) => !v)}
            aria-label={`Abrir notificaciones (${unreadCount} no leídas)`}
            aria-haspopup="menu"
            aria-expanded={notifOpen ? "true" : "false"}
          >
            <BellIcon className="topbarBellIcon" animated={paymentPulse} />
            {unreadCount > 0 ? (
              <span className="topbarBellBadge">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </button>
          
          {notifOpen ? (
            <>
              <button
                type="button"
                className="topbarBellBackdrop"
                aria-label="Cerrar notificaciones"
                onClick={() => setNotifOpen(false)}
              />
              <div className="topbarBellPopover" role="menu" aria-label="Notificaciones">
              {/* Header con título arriba y filtros debajo (sin scroll horizontal) */}
              <div className="topbarBellHead">
                <div className="topbarBellHeadRow">
                  <div className="topbarBellTitleGroup">
                    <strong>Notificaciones</strong>
                    {unreadCount > 0 && (
                      <span className="topbarBellUnreadCount">{unreadCount}</span>
                    )}
                  </div>
                  <div className="topbarBellActions">
                    <button
                      type="button"
                      className="topbarBellActionBtn topbarBellActionBtnSmall topbarBellActionBtnIcon"
                      onClick={() => markAll(true)}
                      title="Marcar todo como leído"
                      aria-label="Marcar todo como leído"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="sr-only">Leer</span>
                    </button>
                    <button
                      type="button"
                      className="topbarBellActionBtn topbarBellActionBtnSmall topbarBellActionBtnIcon"
                      onClick={clearAll}
                      title="Limpiar todas"
                      aria-label="Limpiar todas"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 7h12M9 7V5h6v2m-8 0l1 12h6l1-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="sr-only">Limpiar</span>
                    </button>
                  </div>
                </div>
                <div className="topbarBellFilters" role="tablist" aria-label="Filtros">
                  {filterOptions.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      className={`topbarBellFilter ${filter === opt.key ? "is-active" : ""}`}
                      onClick={() => setFilter(opt.key)}
                      role="tab"
                      aria-selected={filter === opt.key ? "true" : "false"}
                      title={opt.label}
                    >
                      <span className="filter-icon" aria-hidden="true">{getFilterIcon(opt.icon)}</span>
                      <span className="sr-only">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Lista de notificaciones */}
              <div className="topbarBellList">
                {filteredNotifications.length > 0 ? (
                  filteredNotifications.map((n) => {
                    const icon = getNotificationIcon({ level: n.level, category: n.category });
                    const colorClass = getNotificationColor(n.level);
                    const destinationHref = n.href || resolveNotificationHref(n.category, n.level, session?.role);
                    // acciones de notificación removidas
                    
                    return (
                      <div
                        key={n.id}
                        className={`topbarBellItem ${colorClass} ${n.read ? "is-read" : "is-unread"}`}
                      >
                        <Link
                          href={destinationHref}
                          prefetch={false}
                          className="topbarBellItemLinkWrap"
                          onClick={() => markNotification(n.id, true)}
                        >
                          <div className="topbarBellItemIcon">{icon}</div>
                          <div className="topbarBellItemContent">
                            <div className="topbarBellItemTitle">
                              {n.title || "Notificación"}
                              {n.duplicateCount && n.duplicateCount > 1 ? (
                                <span className="topbarBellItemDuplicate">×{n.duplicateCount}</span>
                              ) : null}
                            </div>
                            <div className="topbarBellItemMsg">{n.message || "Sin detalle"}</div>
                            <div className="topbarBellItemMeta">
                              <span className="category-badge">{n.category}</span>
                              <span className="time-ago">
                                {new Date(n.ts).toLocaleString("es-CO", { 
                                  hour: "2-digit", 
                                  minute: "2-digit",
                                  day: "2-digit",
                                  month: "2-digit"
                                })}
                              </span>
                            </div>
                          </div>
                          {!n.read && <span className="topbarBellItemDot" />}
                        </Link>
                        {/* acciones removidas para evitar botones flotantes */}
                      </div>
                    );
                  })
                ) : (
                  <div className="topbarBellEmpty">
                    <div className="empty-icon">{getFilterIcon("bell")}</div>
                    <div className="empty-text">
                      {filter === "unread"
                        ? "No tienes notificaciones no leidas"
                        : filter === "read"
                        ? "No tienes notificaciones leidas"
                        : typeof filter === "string" && filter !== "all"
                        ? `No hay notificaciones de ${filter}`
                        : "Sin notificaciones"}
                    </div>
                  </div>
                )}
              </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
