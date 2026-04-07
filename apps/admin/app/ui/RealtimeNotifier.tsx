"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FEED_STORAGE_KEY } from "./notificationsFeed";

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
  const lastSeenRef = useRef<Set<string>>(new Set());
  const soundReadyRef = useRef(false);
  const cashierRef = useRef<HTMLAudioElement | null>(null);
  const paymentFailedRef = useRef<HTMLAudioElement | null>(null);
  const messageSentRef = useRef<HTMLAudioElement | null>(null);
  const messageFailedRef = useRef<HTMLAudioElement | null>(null);

  const addToast = useCallback((toast: ToastEvent) => {
    setToasts((prev) => {
      if (prev.some((t) => t.id === toast.id)) return prev;
      return [toast, ...prev].slice(0, 5);
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Polling liviano para restaurar notificaciones y sonido
  // (se había desactivado el realtime).

  useEffect(() => {
    if (!session?.email) return;

    cashierRef.current = new Audio("/brand/cashier.mp3");
    cashierRef.current.preload = "auto";
    paymentFailedRef.current = new Audio("/brand/payment_failed.wav");
    paymentFailedRef.current.preload = "auto";
    messageSentRef.current = new Audio("/brand/message_sent.wav");
    messageSentRef.current.preload = "auto";
    messageFailedRef.current = new Audio("/brand/message_failed.wav");
    messageFailedRef.current.preload = "auto";

    try {
      const raw = window.localStorage.getItem(FEED_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        const seed = new Set<string>();
        for (const n of parsed) if (n?.id) seed.add(String(n.id));
        lastSeenRef.current = seed;
      }
    } catch {}

    const unlockSound = () => {
      soundReadyRef.current = true;
    };
    window.addEventListener("pointerdown", unlockSound, { once: true });

    // Escuchar eventos de notificación personalizados desde otros componentes
    const handleNotification = (event: Event) => {
      const customEvent = event as CustomEvent<ToastEvent>;
      addToast(customEvent.detail);
    };

    window.addEventListener("notification", handleNotification);

    return () => {
      window.removeEventListener("notification", handleNotification);
      window.removeEventListener("pointerdown", unlockSound);
    };
  }, [session?.email, addToast]);

  useEffect(() => {
    if (!session?.email) return;

    const playSound = (audio: HTMLAudioElement | null) => {
      if (!audio || !soundReadyRef.current) return;
      try {
        audio.currentTime = 0;
        void audio.play();
      } catch {
        // ignore autoplay restrictions
      }
    };

    const pushFeed = (items: any[]) => {
      try {
        window.localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify(items));
      } catch {}
      window.dispatchEvent(new CustomEvent("apiflujos:notifications-updated", { detail: { items } }));
    };

    const handleItems = (items: any[]) => {
      if (!Array.isArray(items)) return;
      pushFeed(items);

      const nextSeen = new Set(lastSeenRef.current);
      const newItems = items.filter((n) => n?.id && !nextSeen.has(n.id));
      for (const n of items) if (n?.id) nextSeen.add(n.id);
      lastSeenRef.current = nextSeen;

      if (!newItems.length) return;
      for (const n of newItems.slice(0, 3)) {
        const level = String(n.level || "info");
        const category = String(n.category || "");
        const title = String(n.title || "Notificación");
        const message = String(n.message || "");
        if (category === "pagos" && level === "success") {
          playSound(cashierRef.current);
          window.dispatchEvent(new CustomEvent("apiflujos:payment-approved"));
        } else if (category === "pagos" && level === "error") {
          playSound(paymentFailedRef.current);
        } else if (title.toLowerCase().includes("mensaje") && level === "success") {
          playSound(messageSentRef.current);
        } else if (title.toLowerCase().includes("mensaje") && level === "error") {
          playSound(messageFailedRef.current);
        }
        addToast({
          id: `toast:${n.id}`,
          type: level === "error" ? "error" : level === "warning" ? "warning" : level === "success" ? "success" : "info",
          title,
          message,
          timestamp: n.ts || new Date().toISOString(),
          href: n.href || undefined
        });
      }
    };

    let running = true;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchNotifications = async () => {
      try {
        const res = await fetch("/api/realtime/notifications?limit=40", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!running) return;
        if (json?.notifications) {
          handleItems(json.notifications);
        }
      } catch {
        // ignore polling failures
      }
    };

    const startPolling = () => {
      if (timer) return;
      fetchNotifications();
      timer = setInterval(fetchNotifications, 20000);
    };

    const stopPolling = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    try {
      es = new EventSource("/api/realtime?channel=notifications", { withCredentials: true });
      es.addEventListener("ready", () => {
        stopPolling();
        void fetchNotifications();
      });
      es.addEventListener("message", () => {
        void fetchNotifications();
      });
      es.onerror = () => {
        startPolling();
      };
    } catch {
      startPolling();
    }

    fetchNotifications();

    return () => {
      running = false;
      stopPolling();
      es?.close();
    };
  }, [session?.email, addToast]);

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
