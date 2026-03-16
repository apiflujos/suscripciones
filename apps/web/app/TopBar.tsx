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
  meta?: any;
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

function getNotificationIcon({ level, category }: { level: NotificationLevel; category?: NotificationCategory }) {
  // Íconos SVG genéricos que van con la estética de la plataforma
  if (category === "pagos") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    );
  }
  if (category === "suscripciones") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    );
  }
  if (category === "clientes") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  if (level === "success") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (level === "error") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (level === "warning") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  // Ícono default (campana)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function getNotificationColor(level: NotificationLevel): string {
  switch (level) {
    case "success": return "notification-success";
    case "error": return "notification-error";
    case "warning": return "notification-warning";
    default: return "notification-info";
  }
}

function getFilterIcon(iconName: string) {
  switch (iconName) {
    case "bell":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "card":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      );
    case "refresh":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );
    case "users":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      );
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
    { key: "unread" as const, label: "No leídas", icon: "bell" },
    { key: "read" as const, label: "Leídas", icon: "check" },
    { key: "pagos" as const, label: "Pagos", icon: "card" },
    { key: "suscripciones" as const, label: "Suscripciones", icon: "refresh" },
    { key: "clientes" as const, label: "Clientes", icon: "users" },
    { key: "all" as const, label: "Todas", icon: "list" }
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

    const buildNotifications = (rawItems: any[]) => {
      if (!Array.isArray(rawItems)) {
        setNotifications([]);
        return;
      }

      // FIX: Agrupar notificaciones idénticas con lógica mejorada
      const grouped = new Map<string, HeaderNotification>();
      for (const raw of rawItems.slice(0, 100)) {
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
        const itemDate = item?.ts ? new Date(item.ts).toDateString() : "unknown";
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
          duplicateCount: existing ? (existing.duplicateCount || 1) + 1 : 1,
          meta: item?.meta
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
    };

    const load = () => {
      try {
        const raw = window.localStorage.getItem(FEED_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        buildNotifications(parsed);
      } catch {
        setNotifications([]);
      }
    };

    loadRead();
    load();

    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (detail && Array.isArray(detail.items)) {
        buildNotifications(detail.items);
        return;
      }
      load();
    };
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
    <header className="topbar" aria-label="Topbar">
      <div className="topbarLeft">
        <div className="topbarLeftRow">
          <Link href="/" className="topbarLogoLink" prefetch={false} aria-label="Ir al home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo_horizontal.svg" alt="Logo" className="topbarLogo" data-theme-logo="horizontal" />
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
                    Leer
                  </button>
                  <button
                    type="button"
                    className="topbarBellActionBtn topbarBellActionBtnSmall"
                    onClick={clearAll}
                    title="Limpiar todas"
                  >
                    Limpiar
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
                    <span className="filter-icon">{getFilterIcon(opt.icon)}</span>
                    <span className="filter-label">{opt.label}</span>
                  </button>
                ))}
              </div>
              
              {/* Lista de notificaciones */}
              <div className="topbarBellList">
                {filteredNotifications.length > 0 ? (
                  filteredNotifications.map((n) => {
                    const icon = getNotificationIcon({ level: n.level, category: n.category });
                    const colorClass = getNotificationColor(n.level);
                    const destinationHref = n.href || resolveNotificationHref(n.category, n.level, session?.role);
                    const contactPayload = resolveContactPayload(n.meta);
                    const allowCreate = canCreateContact(n) && Boolean(contactPayload);
                    const isCreating = creatingContactId === n.id;
                    
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
                        {allowCreate ? (
                          <div className="topbarBellItemActions">
                            <button
                              type="button"
                              className="topbarBellItemCta"
                              data-loader="off"
                              disabled={isCreating}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                createContactFromNotification(n);
                              }}
                            >
                              {isCreating ? "Creando..." : "Crear contacto"}
                            </button>
                          </div>
                        ) : null}
                      </div>
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
