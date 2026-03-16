"use client";

import { useEffect, useState } from "react";
import { HelpTip } from "../ui/HelpTip";

type NotificationCategory = "pagos" | "suscripciones" | "clientes" | "sistema";
type NotificationLevel = "success" | "warning" | "error" | "info";

type Notification = {
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

function getNotificationIcon(level: NotificationLevel): string {
  switch (level) {
    case "success": return "✅";
    case "error": return "❌";
    case "warning": return "⚠️";
    default: return "📬";
  }
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

export function UserNotificationsPanel() {
  const FEED_STORAGE_KEY = "apiflujos-notifications-feed";
  const READ_STORAGE_KEY = "apiflujos-notifications-read-ids";
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<"all" | "unread" | NotificationCategory>("unread");
  const readIdsRef = useState<Set<string>>(new Set())[0];

  useEffect(() => {
    const loadRead = () => {
      try {
        const raw = localStorage.getItem(READ_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        for (const id of parsed) readIdsRef.add(String(id || ""));
      } catch {}
    };
    
    const load = () => {
      try {
        const raw = localStorage.getItem(FEED_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) {
          setNotifications([]);
          return;
        }
        
        const grouped = new Map<string, Notification>();
        for (const raw of parsed.slice(0, 50)) {
          const item = raw as any;
          const contentKey = `${item?.title || ""}|${item?.message || ""}|${item?.category || categorizeNotification(item?.title || "", item?.message || "", item?.source)}`;
          
          const existing = grouped.get(contentKey);
          const newItem: Notification = {
            id: item?.id || contentKey,
            ts: item?.ts || new Date().toISOString(),
            title: String(item?.title || ""),
            message: String(item?.message || ""),
            level: item?.level || levelFromSource(item?.source, item?.title),
            category: item?.category || categorizeNotification(item?.title || "", item?.message || "", item?.source),
            href: item?.href || "",
            read: readIdsRef.has(item?.id || contentKey),
            duplicateCount: existing ? (existing.duplicateCount || 1) + 1 : 1
          };
          
          if (!existing || new Date(newItem.ts).getTime() > new Date(existing.ts).getTime()) {
            newItem.duplicateCount = existing ? (existing.duplicateCount || 1) + 1 : 1;
            grouped.set(contentKey, newItem);
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
  }, [readIdsRef]);

  const markNotification = (id: string, read: boolean) => {
    const next = new Set(readIdsRef);
    if (read) next.add(id);
    else next.delete(id);
    
    try {
      localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {}
    
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read } : n)));
  };

  const markAll = (read: boolean) => {
    const next = new Set(readIdsRef);
    for (const n of notifications) {
      if (n?.id) {
        if (read) next.add(n.id);
        else next.delete(n.id);
      }
    }
    
    try {
      localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {}
    
    setNotifications((prev) => prev.map((n) => ({ ...n, read })));
  };

  const clearAll = () => {
    try {
      localStorage.removeItem(FEED_STORAGE_KEY);
      localStorage.removeItem(READ_STORAGE_KEY);
      readIdsRef.clear();
      setNotifications([]);
    } catch {}
  };

  const filteredNotifications = filter === "unread" 
    ? notifications.filter((n) => !n.read)
    : filter === "all"
    ? notifications
    : notifications.filter((n) => n.category === filter);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <section className="settings-group">
      <div className="settings-group-header">
        <div className="panelHeaderRow">
          <h3>
            🔔 Mis Notificaciones
            <HelpTip text="Aquí ves tus notificaciones personales. Los logs del sistema solo los ve el Super Admin." />
          </h3>
          {unreadCount > 0 && (
            <span className="pill pill-blue">{unreadCount} no leídas</span>
          )}
        </div>
      </div>
      
      <div className="settings-group-body">
        {/* Filtros */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`btn-compact ${filter === "unread" ? "primary" : "ghost"}`}
            onClick={() => setFilter("unread")}
          >
            🔔 No leídas
          </button>
          <button
            type="button"
            className={`btn-compact ${filter === "pagos" ? "primary" : "ghost"}`}
            onClick={() => setFilter("pagos")}
          >
            💳 Pagos
          </button>
          <button
            type="button"
            className={`btn-compact ${filter === "suscripciones" ? "primary" : "ghost"}`}
            onClick={() => setFilter("suscripciones")}
          >
            🔄 Suscripciones
          </button>
          <button
            type="button"
            className={`btn-compact ${filter === "clientes" ? "primary" : "ghost"}`}
            onClick={() => setFilter("clientes")}
          >
            👥 Clientes
          </button>
          <button
            type="button"
            className={`btn-compact ${filter === "all" ? "primary" : "ghost"}`}
            onClick={() => setFilter("all")}
          >
            📋 Todas
          </button>
        </div>
        
        {/* Acciones */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className="ghost btn-compact"
            onClick={() => markAll(true)}
            disabled={unreadCount === 0}
          >
            ✅ Marcar todo leído
          </button>
          <button
            type="button"
            className="ghost btn-compact"
            onClick={clearAll}
            disabled={notifications.length === 0}
          >
            🗑️ Limpiar todo
          </button>
        </div>
        
        {/* Lista de notificaciones */}
        <div className="module" style={{ display: "grid", gap: 8 }}>
          {filteredNotifications.length > 0 ? (
            filteredNotifications.map((n) => (
              <a
                key={n.id}
                href={n.href || "/settings"}
                className={`notification-item ${n.read ? "is-read" : "is-unread"}`}
                onClick={() => markNotification(n.id, true)}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid var(--stroke)",
                  background: n.read ? "var(--bg)" : "var(--bg-secondary)",
                  textDecoration: "none",
                  color: "inherit",
                  transition: "all 0.2s"
                }}
              >
                <div style={{ fontSize: "20px" }}>{getNotificationIcon(n.level)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {n.title}
                    {n.duplicateCount && n.duplicateCount > 1 && (
                      <span style={{
                        background: "var(--primary)",
                        color: "white",
                        fontSize: "10px",
                        padding: "1px 6px",
                        borderRadius: "8px",
                        marginLeft: "6px"
                      }}>
                        ×{n.duplicateCount}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: 6 }}>
                    {n.message}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-faint)", display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{
                      background: "var(--bg)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      textTransform: "capitalize"
                    }}>
                      {n.category}
                    </span>
                    <span>
                      {new Date(n.ts).toLocaleString("es-CO", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "2-digit"
                      })}
                    </span>
                  </div>
                </div>
                {!n.read && (
                  <div style={{
                    width: "8px",
                    height: "8px",
                    background: "var(--primary)",
                    borderRadius: "50%"
                  }} />
                )}
              </a>
            ))
          ) : (
            <div style={{
              padding: "40px",
              textAlign: "center",
              color: "var(--muted)"
            }}>
              <div style={{ fontSize: "48px", marginBottom: 16, opacity: 0.5 }}>🔔</div>
              <div>
                {filter === "unread"
                  ? "¡No tienes notificaciones no leídas!"
                  : filter === "all"
                  ? "Sin notificaciones"
                  : `No hay notificaciones de ${filter}`}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
