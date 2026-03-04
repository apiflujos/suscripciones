"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminSession } from "../lib/session";

type Header = { title: string; subtitle: string };
type HeaderNotification = {
  id: string;
  ts: string;
  title: string;
  message: string;
  level?: "info" | "error";
  href?: string | null;
  read?: boolean;
  duplicateCount?: number;
};

function getHeader(pathname: string): Header {
  if (pathname === "/") return { title: "Métricas", subtitle: "Ajusta rango y granularidad para leer la evolución de las métricas." };
  if (pathname.startsWith("/payments")) return { title: "Pagos", subtitle: "Seguimiento de pagos, estados y conciliación." };
  if (pathname.startsWith("/logs")) return { title: "Logs de API", subtitle: "Seguimiento de procesos y sincronizaciones." };
  if (pathname.startsWith("/customers")) return { title: "Contactos", subtitle: "Clientes y datos de contacto." };
  if (pathname.startsWith("/products")) return { title: "Productos y Servicios", subtitle: "Catálogo para cobranza recurrente." };
  if (pathname.startsWith("/billing")) return { title: "Suscripciones", subtitle: "Cobranza recurrente y ciclos." };
  if (pathname.startsWith("/subscriptions")) return { title: "Suscripciones", subtitle: "Cobros, ciclos y links de pago." };
  if (pathname.startsWith("/plans")) return { title: "Planes", subtitle: "Tipos de suscripción: precio y periodicidad." };
  if (pathname.startsWith("/notifications")) return { title: "Notificaciones", subtitle: "Reglas, recordatorios y plantillas." };
  if (pathname.startsWith("/campaigns")) return { title: "Mensajes masivos", subtitle: "Envíos por audiencia con filtros inteligentes." };
  if (pathname.startsWith("/smart-lists")) return { title: "Gamificación", subtitle: "Segmentación dinámica de contactos." };
  if (pathname.startsWith("/webhooks")) return { title: "Webhooks", subtitle: "Eventos entrantes y su estado." };
  if (pathname.startsWith("/settings")) return { title: "Configuración", subtitle: "Credenciales y conexiones." };
  if (pathname.startsWith("/appearance")) return { title: "Apariencia", subtitle: "Tema, visión y contraste." };
  if (pathname.startsWith("/sa") || pathname.startsWith("/__sa")) return { title: "Super Admin", subtitle: "Planes, módulos, usuarios y consumos." };
  return { title: "Panel", subtitle: "—" };
}

function getHeaderWithTab(pathname: string, tab: string): Header {
  if (pathname === "/logs" && tab === "payments") {
    return { title: "Pagos", subtitle: "Seguimiento de pagos, estados y conciliación." };
  }
  return getHeader(pathname);
}

function UserMenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
  const FEED_STORAGE_KEY = "apiflujos-notifications-feed";
  const READ_STORAGE_KEY = "apiflujos-notifications-read-ids";
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const headerTab = String(searchParams?.get("tab") || "");
  const header = useMemo(() => getHeaderWithTab(pathname, headerTab), [pathname, headerTab]);
  const isSuperAdmin = session?.role === "SUPER_ADMIN";
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState<"all" | "unread" | "read">("unread");
  const [notifications, setNotifications] = useState<HeaderNotification[]>([]);
  const [paymentPulse, setPaymentPulse] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const pulseRef = useRef<NodeJS.Timeout | null>(null);
  const readIdsRef = useRef<Set<string>>(new Set());
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const filteredNotifications = useMemo(() => {
    if (notifFilter === "read") return notifications.filter((n) => Boolean(n.read));
    if (notifFilter === "unread") return notifications.filter((n) => !n.read);
    return notifications;
  }, [notifications, notifFilter]);

  const saveReadIds = (ids: Set<string>) => {
    try {
      window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(ids)));
    } catch {}
  };

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

  useEffect(() => {
    const loadRead = () => {
      try {
        const raw = window.localStorage.getItem(READ_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) {
          readIdsRef.current = new Set();
          return;
        }
        readIdsRef.current = new Set(parsed.map((v) => String(v || "")));
      } catch {
        readIdsRef.current = new Set();
      }
    };
    const load = () => {
      try {
        const raw = window.localStorage.getItem(FEED_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) {
          setNotifications([]);
          return;
        }
        const next = parsed.slice(0, 40).map((item: HeaderNotification) => {
          const id = String(item?.id || "");
          return { ...item, read: readIdsRef.current.has(id) };
        });
        setNotifications(next);
      } catch {
        setNotifications([]);
      }
    };
    loadRead();
    load();
    const onUpdated = () => load();
    window.addEventListener("apiflujos:notifications-updated", onUpdated as EventListener);
    return () => window.removeEventListener("apiflujos:notifications-updated", onUpdated as EventListener);
  }, [FEED_STORAGE_KEY, READ_STORAGE_KEY]);

  const markNotification = (id: string, read: boolean) => {
    const next = new Set(readIdsRef.current);
    if (read) next.add(id);
    else next.delete(id);
    readIdsRef.current = next;
    saveReadIds(next);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read } : n)));
  };

  const markAll = (read: boolean) => {
    const next = new Set(readIdsRef.current);
    for (const n of notifications) {
      if (!n?.id) continue;
      if (read) next.add(n.id);
      else next.delete(n.id);
    }
    readIdsRef.current = next;
    saveReadIds(next);
    setNotifications((prev) => prev.map((n) => ({ ...n, read })));
  };

  return (
    <header className="topbar" aria-label="Topbar">
      <div className="topbarLeft">
        <div className="topbarLeftRow">
          <Link href="/" className="topbarLogoLink" prefetch={false} aria-label="Ir al home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.png" alt="Logo" className="topbarLogo" />
            <span className="logoStatusDot" aria-hidden="true" />
          </Link>
          <div className="topbarTitleGroup">
            <h1 className="topbarTitle">{header.title}</h1>
            <div className="topbarSubtitle">{header.subtitle}</div>
          </div>
          <div className={`topbarPulse ${paymentPulse ? "is-active" : ""}`} aria-live="polite">
            <span className="topbarPulseDot" aria-hidden="true" />
            <span className="topbarPulseText">Pago recibido</span>
          </div>
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
                <Link className="userMenuItem" href="/sa" prefetch={false} role="menuitem">
                  Super Admin
                </Link>
              ) : null}
              {isSuperAdmin ? (
                <Link className="userMenuItem" href="/sa/users" prefetch={false} role="menuitem">
                  Usuarios
                </Link>
              ) : null}
              <Link className="userMenuItem isDanger" href="/logout" prefetch={false} role="menuitem">
                Salir
              </Link>
            </div>
          ) : null}
        </div>
        <div className="topbarNotifications" ref={notifRef}>
          <button
            type="button"
            className="topbarBellBtn"
            data-loader="off"
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Abrir notificaciones"
            aria-haspopup="menu"
            aria-expanded={notifOpen ? "true" : "false"}
          >
            <BellIcon className="topbarBellIcon" />
            {unreadCount ? <span className="topbarBellBadge">{Math.min(unreadCount, 99)}</span> : null}
          </button>
          {notifOpen ? (
            <div className="topbarBellPopover" role="menu" aria-label="Notificaciones">
              <div className="topbarBellHead">
                <strong>Notificaciones</strong>
                <div className="topbarBellFilters">
                  <button type="button" className={`topbarBellFilter ${notifFilter === "unread" ? "is-active" : ""}`} onClick={() => setNotifFilter("unread")}>
                    No leídas
                  </button>
                  <button type="button" className={`topbarBellFilter ${notifFilter === "read" ? "is-active" : ""}`} onClick={() => setNotifFilter("read")}>
                    Leídas
                  </button>
                  <button type="button" className={`topbarBellFilter ${notifFilter === "all" ? "is-active" : ""}`} onClick={() => setNotifFilter("all")}>
                    Todas
                  </button>
                </div>
                <div className="topbarBellActions">
                  <button type="button" className="topbarBellActionBtn" onClick={() => markAll(true)}>
                    Marcar todo leído
                  </button>
                  <button type="button" className="topbarBellActionBtn" onClick={() => markAll(false)}>
                    Desmarcar
                  </button>
                </div>
              </div>
              <div className="topbarBellList">
                {filteredNotifications.length ? (
                  filteredNotifications.map((n) => (
                    <div key={n.id} className={`topbarBellItem ${n.read ? "is-read" : "is-unread"}`}>
                      <div>
                        <div className="topbarBellItemTitle">
                          {n.title || "Evento"} {Number(n.duplicateCount || 1) > 1 ? `x${Number(n.duplicateCount)}` : ""}
                        </div>
                        <div className="topbarBellItemMsg">{n.message || "Sin detalle"}</div>
                        <div className="topbarBellItemMeta">
                          {new Date(n.ts).toLocaleString("es-CO", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                        </div>
                        {n.href ? (
                          <a className="topbarBellItemLink" href={n.href} data-loader="off">
                            Ver detalle
                          </a>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="topbarBellToggleRead"
                        onClick={() => markNotification(n.id, !n.read)}
                        aria-label={n.read ? "Marcar como no leída" : "Marcar como leída"}
                      >
                        {n.read ? "No leída" : "Leída"}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="topbarBellEmpty">Sin notificaciones en este filtro.</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
