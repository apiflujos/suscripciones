"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RealtimeEvent = {
  id: string;
  type: "webhook" | "job";
  level: "info" | "error";
  ts: string;
  title: string;
  message: string;
};

type Toast = RealtimeEvent & { seenAt: number };
type RealtimeStatus = "connecting" | "connected" | "disconnected";

const STORAGE_KEY = "apiflujos-realtime-last";

export function RealtimeNotifier() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const lastSeenRef = useRef<string>("");
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);

  const lastSeen = useMemo(() => {
    if (typeof window === "undefined") return "";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved || "";
  }, []);

  useEffect(() => {
    if (lastSeen) lastSeenRef.current = lastSeen;
  }, [lastSeen]);

  useEffect(() => {
    let source: EventSource | null = null;
    let active = true;

    const connect = () => {
      if (!active) return;
      setStatus("connecting");
      const since = lastSeenRef.current || new Date(Date.now() - 60 * 1000).toISOString();
      source = new EventSource(`/api/realtime?since=${encodeURIComponent(since)}`);

      source.onopen = () => {
        if (!active) return;
        setStatus("connected");
      };

      source.onmessage = (evt) => {
        if (!evt.data) return;
        const payload = JSON.parse(evt.data || "{}");
        const events: RealtimeEvent[] = Array.isArray(payload.events) ? payload.events : [];
        if (!events.length) return;

        const now = Date.now();
        setToasts((prev) => {
          const merged = [...events.map((e) => ({ ...e, seenAt: now })), ...prev];
          return merged.slice(0, 6);
        });

        const latestTs = events
          .map((e) => new Date(e.ts).getTime())
          .filter((t) => Number.isFinite(t))
          .sort((a, b) => b - a)[0];
        if (latestTs) {
          const iso = new Date(latestTs).toISOString();
          lastSeenRef.current = iso;
          window.localStorage.setItem(STORAGE_KEY, iso);
        }
      };

      source.onerror = () => {
        if (!active) return;
        setStatus("disconnected");
        source?.close();
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 6000);
      };
    };

    connect();
    return () => {
      active = false;
      source?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) =>
      setTimeout(() => {
        setToasts((prev) => prev.filter((p) => p.id !== t.id));
      }, 7000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const pushTestToast = () => {
    const now = new Date().toISOString();
    const test: Toast = {
      id: `test_${Date.now()}`,
      type: "webhook",
      level: "info",
      ts: now,
      title: "Notificación de prueba",
      message: "Si ves esto, los avisos en tiempo real están activos en tu sesión.",
      seenAt: Date.now()
    };
    setToasts((prev) => [test, ...prev].slice(0, 6));
  };

  return (
    <div className="realtime-toasts" aria-live="polite">
      <div className={`realtime-status is-${status}`}>
        <span className="realtime-status-dot" aria-hidden="true" />
        <span className="realtime-status-text">
          {status === "connected" ? "Tiempo real: conectado" : status === "connecting" ? "Tiempo real: conectando" : "Tiempo real: desconectado"}
        </span>
        <button className="ghost btn-compact" type="button" onClick={pushTestToast} data-loader="off">
          Probar
        </button>
      </div>
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.level === "error" ? "is-error" : "is-info"}`}>
          <div className="toast-title">{toast.title}</div>
          <div className="toast-message">{toast.message}</div>
          <div className="toast-meta">
            <span>{toast.type === "webhook" ? "Webhook" : "Job"}</span>
            <span>{new Date(toast.ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
