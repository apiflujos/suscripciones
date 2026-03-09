"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminSession } from "../lib/session";
import { isNoiseNotification, normalizeSystemText } from "./lib/logPresentation";

type Header = { title: string; subtitle: string };

type NotificationCategory = "pagos" | "suscripciones" | "clientes" | "sistema";
type NotificationLevel = "success" | "warning" | "error" | "info";

type HeaderNotification = {
  id: string;
  ts: string;
  title: string;
  message: string;
  level: NotificationLevel;
  category: NotificationCategory;
  href: string;
  read: boolean;
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

function categorizeNotification(title: string, message: string, source?: string): NotificationCategory {
  const text = `${title} ${message} ${source || ""}`.toLowerCase();
  if (/pago|payment|cobro|wompi|transacci/.test(text)) return "pagos";
  if (/suscripci|subscription|ciclo|reintento|mora/.test(text)) return "suscripciones";
  if (/cliente|customer|contact|email|tel/.test(text)) return "clientes";
  return "sistema";
}

function levelFromSource(source?: string, title?: string): NotificationLevel {
  const text = `${source || ""} ${title || ""}`.toLowerCase();
  if (/aprob|success|ok|pago recibid/.test(text)) return "success";
  if (/fall|error|declin|fail/.test(text)) return "error";
  if (/warn|advert|atenci|recordator/.test(text)) return "warning";
  return "info";
}

function resolveNotificationHref(category: NotificationCategory, level: NotificationLevel, role?: string | null): string {
  // Usuarios normales NUNCA ven logs - solo Super Admin
  const isSuperAdmin = role === "SUPER_ADMIN";
  
  // Mapeo directo por categoría
  const categoryMap: Record<NotificationCategory, string> = {
    "pagos": "/payments",
    "suscripciones": "/billing",
    "clientes": "/customers",
    "sistema": isSuperAdmin ? "/logs" : "/settings"  // Usuarios → Configuración, Admin → Logs
  };
  
  const baseHref = categoryMap[category];
  
  // Solo Super Admin puede ir a logs
  if (isSuperAdmin && level === "error") {
    return "/logs?level=ERROR";
  }
  
  return baseHref;
}

function getNotificationIcon(level: NotificationLevel): string {
  switch (level) {
    case "success": return "✅";
    case "error": return "❌";
    case "warning": return "⚠️";
    default: return "📬";
  }
}

function getNotificationColor(level: NotificationLevel): string {
  switch (level) {
    case "success": return "notification-success";
    case "error": return "notification-error";
    case "warning": return "notification-warning";
    default: return "notification-info";
  }
}

export function TopBar({ session }: { session: AdminSession | null }) {
  const FEED_STORAGE_KEY = "apiflujos-notifications-feed";
  const READ_STORAGE_KEY = "apiflujos-notifications-read-ids";
  const pathname = usePathname() || "/";
  const header = useMemo(() => getHeader(pathname), [pathname]);
  const isSuperAdmin = session?.role === "SUPER_ADMIN";
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState<"all" | "unread" | "read" | NotificationCategory>("unread");
  const [notifications, setNotifications] = useState<HeaderNotification[]>([]);
  const [paymentPulse, setPaymentPulse] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const pulseRef = useRef<NodeJS.Timeout | null>(null);
  const readIdsRef = useRef<Set<string>>(new Set());
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  
  // Filtros simplificados
  const filterOptions = useMemo(() => [
    { key: "unread" as const, label: "No leídas", icon: "🔔" },
    { key: "read" as const, label: "Leídas", icon: "✅" },
    { key: "pagos" as const, label: "Pagos", icon: "💳" },
    { key: "suscripciones" as const, label: "Suscripciones", icon: "🔄" },
    { key: "clientes" as const, label: "Clientes", icon: "👥" },
    { key: "all" as const, label: "Todas", icon: "📋" }
  ], []);

  const filteredNotifications = useMemo(() => {
    if (notifFilter === "read") return notifications.filter((n) => n.read);
    if (notifFilter === "unread") return notifications.filter((n) => !n.read);
    if (notifFilter === "all") return notifications;
    // Filtro por categoría
    return notifications.filter((n) => n.category === notifFilter);
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
        readIdsRef.current = new Set(parsed.map((v: string) => String(v || "")));
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

        // FIX: Agrupar notificaciones idénticas con lógica mejorada
        const grouped = new Map<string, HeaderNotification>();
        for (const raw of parsed.slice(0, 100)) {
          const item = raw as any;

          // Filtrar ruido (solo para no super admin)
          if (!isSuperAdmin && isNoiseNotification({
            source: item?.source,
            title: item?.title,
            message: item?.message,
            kind: item?.kind
          })) {
            continue;
          }

          // FIX: Clave única incluye categoría y fecha para evitar falsos duplicados
          const title = normalizeSystemText(item?.title || "");
          const message = normalizeSystemText(item?.message || "");
          const category = item?.category || categorizeNotification(title, message, item?.source);
          const itemDate = item?.ts ? new Date(item.ts).toDateString() : 'unknown';
          const contentKey = `${title}|${message}|${category}|${itemDate}`;

          const existing = grouped.get(contentKey);
          const newItem: HeaderNotification = {
            id: item?.id || contentKey,
            ts: item?.ts || new Date().toISOString(),
            title: title,
            message: message,
            level: item?.level || levelFromSource(item?.source, item?.title),
            category: category,
            href: item?.href || "",
            read: readIdsRef.current.has(item?.id || contentKey),
            duplicateCount: existing ? (existing.duplicateCount || 1) + 1 : 1
          };

          // FIX: Solo agrupar si son realmente el mismo evento (misma hora)
          if (!existing) {
            grouped.set(contentKey, newItem);
            continue;
          }
          
          // Si los timestamps son muy diferentes (> 1 hora), no agrupar
          const existingTs = new Date(existing.ts).getTime();
          const newItemTs = new Date(newItem.ts).getTime();
          const timeDiffMs = Math.abs(newItemTs - existingTs);
          const oneHourMs = 60 * 60 * 1000;
          
          if (timeDiffMs > oneHourMs) {
            // Crear entrada separada
            const newKey = `${contentKey}|${newItemTs}`;
            grouped.set(newKey, { ...newItem, id: newKey, duplicateCount: 1 });
            continue;
          }
          
          // Mismo evento, actualizar contador
          if (newItemTs > existingTs) {
            newItem.duplicateCount = (existing.duplicateCount || 1) + 1;
            grouped.set(contentKey, newItem);
          } else {
            existing.duplicateCount = (existing.duplicateCount || 1) + 1;
          }
        }

        const next = Array.from(grouped.values())
          .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
          .slice(0, 50);

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
  }, [FEED_STORAGE_KEY, READ_STORAGE_KEY, isSuperAdmin]);

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

  const clearAll = () => {
    try {
      window.localStorage.removeItem(FEED_STORAGE_KEY);
      window.localStorage.removeItem(READ_STORAGE_KEY);
      readIdsRef.current = new Set();
      setNotifications([]);
    } catch {}
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
            <div className="topbarBellPopover" role="menu" aria-label="Notificaciones">
              {/* Header con título y acciones */}
              <div className="topbarBellHead">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Notificaciones</strong>
                  {unreadCount > 0 && (
                    <span className="topbarBellUnreadCount">{unreadCount}</span>
                  )}
                </div>
                <div className="topbarBellActions">
                  <button 
                    type="button" 
                    className="topbarBellActionBtn topbarBellActionBtnSmall" 
                    onClick={() => markAll(true)}
                    title="Marcar todo como leído"
                  >
                    ✅
                  </button>
                  <button 
                    type="button" 
                    className="topbarBellActionBtn topbarBellActionBtnSmall" 
                    onClick={clearAll}
                    title="Limpiar todas"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              
              {/* Filtros SIMPLIFICADOS */}
              <div className="topbarBellFilters">
                {filterOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`topbarBellFilter ${notifFilter === opt.key ? "is-active" : ""}`}
                    onClick={() => setNotifFilter(opt.key)}
                  >
                    <span className="filter-icon">{opt.icon}</span>
                    <span className="filter-label">{opt.label}</span>
                  </button>
                ))}
              </div>
              
              {/* Lista de notificaciones */}
              <div className="topbarBellList">
                {filteredNotifications.length > 0 ? (
                  filteredNotifications.map((n) => {
                    const icon = getNotificationIcon(n.level);
                    const colorClass = getNotificationColor(n.level);
                    const destinationHref = n.href || resolveNotificationHref(n.category, n.level, session?.role);
                    
                    return (
                      <Link 
                        key={n.id} 
                        href={destinationHref}
                        prefetch={false}
                        className={`topbarBellItem ${colorClass} ${n.read ? "is-read" : "is-unread"}`}
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
                    );
                  })
                ) : (
                  <div className="topbarBellEmpty">
                    <div className="empty-icon">🔔</div>
                    <div className="empty-text">
                      {notifFilter === "unread" 
                        ? "¡No tienes notificaciones no leídas!" 
                        : notifFilter === "read"
                        ? "No tienes notificaciones leídas"
                        : typeof notifFilter === "string" && notifFilter !== "all"
                        ? `No hay notificaciones de ${notifFilter}`
                        : "Sin notificaciones"}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
