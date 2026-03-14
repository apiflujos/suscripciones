"use client";

import { useEffect, useState, useCallback, useRef } from "react";

type ToastEvent = {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
  timestamp: string;
  href?: string;
};

type RealtimeNotifierProps = {
  children?: React.ReactNode;
  session?: { email?: string } | null;
};

export function RealtimeNotifier({ children, session }: RealtimeNotifierProps) {
  const [toasts, setToasts] = useState<ToastEvent[]>([]);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSeenIdRef = useRef<string>("");

  const addToast = useCallback((toast: ToastEvent) => {
    setToasts((prev) => {
      if (prev.some((t) => t.id === toast.id)) return prev;
      return [toast, ...prev].slice(0, 5);
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!session?.email) return;

    try {
      const res = await fetch("/api/realtime/notifications?limit=5", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include"
      });

      if (!res.ok) return;

      const data = await res.json();
      const notifications = data.notifications || [];

      notifications.forEach((n: any) => {
        if (n.id !== lastSeenIdRef.current) {
          lastSeenIdRef.current = n.id;
          addToast({
            id: n.id,
            type: n.level === "error" ? "error" : n.level === "success" ? "success" : n.level === "warning" ? "warning" : "info",
            title: n.title || "Notificación",
            message: n.message || "",
            timestamp: n.ts || new Date().toISOString(),
            href: n.href
          });
        }
      });
    } catch (err) {
      console.error("Error fetching notifications:", err);
    }
  }, [session?.email, addToast]);

  useEffect(() => {
    if (!session?.email) return;

    fetchNotifications();
    pollIntervalRef.current = setInterval(fetchNotifications, 10000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchNotifications, session?.email]);

  const getToastIcon = (type: string) => {
    switch (type) {
      case "success":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        );
      case "error":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        );
      case "warning":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        );
    }
  };

  return (
    <>
      {children}

      {/* Contenedor de toasts */}
      <div className="realtime-toasts">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.type === "error" ? "is-error" : ""} ${toast.href ? "is-clickable" : ""}`}
            onClick={() => {
              if (toast.href) {
                window.location.href = toast.href;
              }
            }}
          >
            <div className="toast-icon" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px" }}>
              {getToastIcon(toast.type)}
            </div>
            <div className="toast-body">
              <div className="toast-title-row">
                <div className="toast-title-wrap">
                  <span className="toast-title">{toast.title}</span>
                </div>
              </div>
              <div className="toast-message">{toast.message}</div>
              <div className="toast-meta">
                <span className="time-ago">
                  {new Date(toast.timestamp).toLocaleString("es-CO", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "2-digit"
                  })}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Auto-dismiss */}
      {toasts.map((toast) => (
        <AutoDismiss key={toast.id} id={toast.id} duration={toast.type === "error" ? 8000 : 5000} onDismiss={removeToast} />
      ))}
    </>
  );
}

function AutoDismiss({ id, duration, onDismiss }: { id: string; duration: number; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(id);
    }, duration);
    return () => clearTimeout(timer);
  }, [id, duration, onDismiss]);

  return null;
}
