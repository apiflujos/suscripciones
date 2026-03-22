"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isNoiseNotification, normalizeSystemText } from "../lib/logPresentation";

export type NotificationCategory = "pagos" | "suscripciones" | "clientes" | "sistema";
export type NotificationLevel = "success" | "warning" | "error" | "info";
export type NotificationFilter = "unread" | "read" | "pagos" | "suscripciones" | "clientes" | "sistema" | "all";

export type NotificationItem = {
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

const FEED_STORAGE_KEY = "apiflujos-notifications-feed";
const READ_STORAGE_KEY = "apiflujos-notifications-read-ids";

export function categorizeNotification(title: string, message: string, source?: string): NotificationCategory {
  const text = `${title} ${message} ${source || ""}`.toLowerCase();
  if (/pago|payment|cobro|wompi|transacci/.test(text)) return "pagos";
  if (/suscripci|subscription|ciclo|reintento|mora/.test(text)) return "suscripciones";
  if (/cliente|customer|contact|email|tel/.test(text)) return "clientes";
  return "sistema";
}

export function levelFromSource(source?: string, title?: string): NotificationLevel {
  const text = `${source || ""} ${title || ""}`.toLowerCase();
  if (/aprob|success|ok|pago recibid/.test(text)) return "success";
  if (/fall|error|declin|fail/.test(text)) return "error";
  if (/warn|advert|atenci|recordator/.test(text)) return "warning";
  return "info";
}

export function resolveNotificationHref(category: NotificationCategory, level: NotificationLevel, role?: string | null): string {
  const isSuperAdmin = role === "SUPER_ADMIN";
  const categoryMap: Record<NotificationCategory, string> = {
    pagos: "/payments",
    suscripciones: "/billing",
    clientes: "/customers",
    sistema: isSuperAdmin ? "/logs" : "/settings"
  };
  const baseHref = categoryMap[category];
  if (isSuperAdmin && level === "error") return "/logs?level=ERROR";
  return baseHref;
}

export function getNotificationIcon({ level, category }: { level: NotificationLevel; category?: NotificationCategory }) {
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
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function getNotificationColor(level: NotificationLevel): string {
  switch (level) {
    case "success":
      return "notification-success";
    case "error":
      return "notification-error";
    case "warning":
      return "notification-warning";
    default:
      return "notification-info";
  }
}

export function getFilterIcon(iconName: string) {
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
    case "alert":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case "list":
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
    default:
      return null;
  }
}

function buildNotifications(rawItems: any[], isSuperAdmin: boolean, readIds: Set<string>) {
  if (!Array.isArray(rawItems)) return [];
  const grouped = new Map<string, NotificationItem>();
  for (const raw of rawItems.slice(0, 100)) {
    const item = raw as any;
    if (!isSuperAdmin && isNoiseNotification({
      source: item?.source,
      title: item?.title,
      message: item?.message,
      kind: item?.kind
    })) {
      continue;
    }

    const title = normalizeSystemText(item?.title || "");
    const message = normalizeSystemText(item?.message || "");
    const category = item?.category || categorizeNotification(title, message, item?.source);
    const itemDate = item?.ts ? new Date(item.ts).toDateString() : "unknown";
    const contentKey = `${title}|${message}|${category}|${itemDate}`;

    const existing = grouped.get(contentKey);
    const newItem: NotificationItem = {
      id: item?.id || contentKey,
      ts: item?.ts || new Date().toISOString(),
      title,
      message,
      level: item?.level || levelFromSource(item?.source, item?.title),
      category,
      href: item?.href || "",
      read: readIds.has(item?.id || contentKey),
      duplicateCount: existing ? (existing.duplicateCount || 1) + 1 : 1,
      meta: item?.meta
    };

    if (!existing) {
      grouped.set(contentKey, newItem);
      continue;
    }

    const existingTs = new Date(existing.ts).getTime();
    const newItemTs = new Date(newItem.ts).getTime();
    const oneHourMs = 60 * 60 * 1000;
    if (Math.abs(newItemTs - existingTs) > oneHourMs) {
      const newKey = `${contentKey}|${newItemTs}`;
      grouped.set(newKey, { ...newItem, id: newKey, duplicateCount: 1 });
      continue;
    }

    if (newItemTs > existingTs) {
      newItem.duplicateCount = (existing.duplicateCount || 1) + 1;
      grouped.set(contentKey, newItem);
    } else {
      existing.duplicateCount = (existing.duplicateCount || 1) + 1;
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 50);
}

export function useNotificationsFeed(args: { isSuperAdmin: boolean }) {
  const { isSuperAdmin } = args;
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<NotificationFilter>("unread");
  const readIdsRef = useRef<Set<string>>(new Set());

  const filterOptions = useMemo(() => [
    { key: "unread" as const, label: "No leidas", icon: "bell" },
    { key: "read" as const, label: "Leidas", icon: "check" },
    { key: "pagos" as const, label: "Pagos", icon: "card" },
    { key: "suscripciones" as const, label: "Suscripciones", icon: "refresh" },
    { key: "clientes" as const, label: "Clientes", icon: "users" },
    { key: "sistema" as const, label: "Sistema", icon: "alert" },
    { key: "all" as const, label: "Todas", icon: "list" }
  ], []);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const filteredNotifications = useMemo(() => {
    if (filter === "unread") return notifications.filter((n) => !n.read);
    if (filter === "read") return notifications.filter((n) => n.read);
    if (filter === "all") return notifications;
    return notifications.filter((n) => n.category === filter);
  }, [notifications, filter]);

  const saveReadIds = (ids: Set<string>) => {
    try {
      window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(ids)));
    } catch {}
  };

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
        const next = buildNotifications(parsed, isSuperAdmin, readIdsRef.current);
        setNotifications(next);
      } catch {
        setNotifications([]);
      }
    };

    loadRead();
    load();

    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (detail && Array.isArray(detail.items)) {
        setNotifications(buildNotifications(detail.items, isSuperAdmin, readIdsRef.current));
        return;
      }
      load();
    };
    window.addEventListener("apiflujos:notifications-updated", onUpdated as EventListener);
    return () => window.removeEventListener("apiflujos:notifications-updated", onUpdated as EventListener);
  }, [isSuperAdmin]);

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

  return {
    notifications,
    filteredNotifications,
    filter,
    setFilter,
    filterOptions,
    unreadCount,
    markNotification,
    markAll,
    clearAll
  };
}
