"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type RealtimeEvent = {
  id: string;
  type: "webhook" | "job" | "system";
  level: "info" | "error";
  ts: string;
  title: string;
  message: string;
  paymentStatus?: string | null;
  paymentType?: string | null;
  sound?: "cash" | "fail" | null;
  kind?: string | null;
  href?: string | null;
  badge?: string | null;
};

type Toast = RealtimeEvent & { seenAt: number };
type RealtimeStatus = "connecting" | "connected" | "disconnected";

const STORAGE_KEY = "apiflujos-realtime-last";

export function RealtimeNotifier() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [usePolling, setUsePolling] = useState(false);
  const lastSeenRef = useRef<string>("");
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);
  const errorCountRef = useRef(0);
  const soundEnabledRef = useRef(false);
  const soundEnabledStateRef = useRef(false);
  const volumeRef = useRef(0.55);
  const lastSoundRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastMessageRef = useRef<number>(0);
  const healthRef = useRef<NodeJS.Timeout | null>(null);

  const [soundEnabled, setSoundEnabled] = useState(false);
  const [volume, setVolume] = useState(0.55);

  const lastSeen = useMemo(() => {
    if (typeof window === "undefined") return "";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved || "";
  }, []);

  useEffect(() => {
    if (lastSeen) lastSeenRef.current = lastSeen;
  }, [lastSeen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.getElementById("realtime-slot");
    if (el) setSlot(el);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("apiflujos-realtime-sound");
    if (stored === "1") {
      soundEnabledRef.current = true;
      soundEnabledStateRef.current = true;
      setSoundEnabled(true);
    }
    const storedVolume = window.localStorage.getItem("apiflujos-realtime-sound-volume");
    if (storedVolume) {
      const v = Number(storedVolume);
      if (Number.isFinite(v) && v > 0) {
        volumeRef.current = Math.min(1, Math.max(0.1, v));
        setVolume(volumeRef.current);
      }
    }
    const primeAudio = () => {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      try {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
        setTimeout(() => ctx.close().catch(() => {}), 120);
      } catch {}
    };

    const enable = () => {
      soundEnabledRef.current = true;
      if (!soundEnabledStateRef.current) {
        soundEnabledStateRef.current = true;
        setSoundEnabled(true);
      }
      primeAudio();
      try {
        window.localStorage.setItem("apiflujos-realtime-sound", "1");
      } catch {}
    };
    document.addEventListener("pointerdown", enable, { once: true });
    return () => document.removeEventListener("pointerdown", enable);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSettings = (evt: Event) => {
      const detail = (evt as CustomEvent)?.detail || {};
      const nextEnabled = detail.soundEnabled === true;
      const nextVolume = Number(detail.volume);
      if (detail.soundEnabled != null) {
        soundEnabledRef.current = nextEnabled;
        soundEnabledStateRef.current = nextEnabled;
        setSoundEnabled(nextEnabled);
      }
      if (Number.isFinite(nextVolume)) {
        const v = Math.min(1, Math.max(0.1, nextVolume));
        volumeRef.current = v;
        setVolume(v);
      }
    };
    const onTest = () => {
      pushTestToast();
    };
    window.addEventListener("apiflujos:realtime-settings", onSettings as EventListener);
    window.addEventListener("apiflujos:realtime-test", onTest);
    return () => {
      window.removeEventListener("apiflujos:realtime-settings", onSettings as EventListener);
      window.removeEventListener("apiflujos:realtime-test", onTest);
    };
  }, []);

  const playCashSound = () => {
    if (typeof window === "undefined") return;
    if (!soundEnabledRef.current) return;
    const nowMs = Date.now();
    if (nowMs - lastSoundRef.current < 3000) return;
    lastSoundRef.current = nowMs;
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    ctx.resume().catch(() => {});
    const now = ctx.currentTime;

    const base = volumeRef.current || 0.55;

    const playTone = (type: OscillatorType, startFreq: number, endFreq: number, startAt: number, duration: number, gainLevel: number) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, startAt);
      g.gain.exponentialRampToValueAtTime(gainLevel * base, startAt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      g.connect(ctx.destination);

      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(startFreq, startAt);
      o.frequency.exponentialRampToValueAtTime(endFreq, startAt + duration);
      o.connect(g);
      o.start(startAt);
      o.stop(startAt + duration);
    };

    // "Ka" thunk
    playTone("sawtooth", 220, 110, now, 0.12, 0.35);
    // "Ching" bell
    playTone("triangle", 1200, 800, now + 0.04, 0.22, 0.45);
    playTone("sine", 1600, 900, now + 0.08, 0.25, 0.35);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 700);
  };

  const playFailSound = () => {
    if (typeof window === "undefined") return;
    if (!soundEnabledRef.current) return;
    const nowMs = Date.now();
    if (nowMs - lastSoundRef.current < 1500) return;
    lastSoundRef.current = nowMs;
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    ctx.resume().catch(() => {});
    const now = ctx.currentTime;

    const base = volumeRef.current || 0.55;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.45 * base, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.35);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.35);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 500);
  };

  const handleEvents = (events: RealtimeEvent[], serverTime?: string) => {
    if (!events.length) return;

    let shouldPlayCash = false;
    let shouldPlayFail = false;
    const now = Date.now();
    const freshEvents = events.filter((e) => {
      if (!e?.id) return true;
      if (seenIdsRef.current.has(e.id)) return false;
      seenIdsRef.current.add(e.id);
      return true;
    });
    if (seenIdsRef.current.size > 300) {
      const trimmed = Array.from(seenIdsRef.current).slice(-200);
      seenIdsRef.current = new Set(trimmed);
    }
    for (const e of freshEvents) {
      if (e.sound === "cash") {
        shouldPlayCash = true;
        try {
          window.dispatchEvent(new CustomEvent("apiflujos:payment-approved", { detail: e }));
        } catch {}
      }
      if (e.sound === "fail") shouldPlayFail = true;
    }
    setToasts((prev) => {
      const merged = [...freshEvents.map((e) => ({ ...e, seenAt: now })), ...prev];
      return merged.slice(0, 6);
    });
    if (shouldPlayCash) playCashSound();
    if (shouldPlayFail && !shouldPlayCash) playFailSound();

    const latestTs = events
      .map((e) => new Date(e.ts).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => b - a)[0];
    if (latestTs) {
      const iso = new Date(latestTs).toISOString();
      lastSeenRef.current = iso;
      window.localStorage.setItem(STORAGE_KEY, iso);
    } else if (serverTime) {
      lastSeenRef.current = serverTime;
      window.localStorage.setItem(STORAGE_KEY, serverTime);
    }
  };

  useEffect(() => {
    if (usePolling) return;
    let source: EventSource | null = null;
    let active = true;

    const connect = () => {
      if (!active) return;
      setStatus("connecting");
      const since = lastSeenRef.current || new Date(Date.now() - 60 * 1000).toISOString();
      source = new EventSource(`/api/realtime?since=${encodeURIComponent(since)}`);
      source.onopen = () => {
        if (!active) return;
        errorCountRef.current = 0;
        setStatus("connected");
        lastMessageRef.current = Date.now();
      };

      source.onmessage = (evt) => {
        if (!evt.data) return;
        let payload: any = {};
        try {
          payload = JSON.parse(evt.data || "{}");
        } catch {
          return;
        }
        const events: RealtimeEvent[] = Array.isArray(payload.events) ? payload.events : [];
        handleEvents(events, payload.serverTime);
        lastMessageRef.current = Date.now();
        setStatus("connected");
      };

      source.onerror = () => {
        if (!active) return;
        setStatus("disconnected");
        source?.close();
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        errorCountRef.current += 1;
        if (errorCountRef.current >= 2) {
          setUsePolling(true);
          return;
        }
        reconnectRef.current = setTimeout(connect, 6000);
      };
    };

    connect();
    if (healthRef.current) clearInterval(healthRef.current);
    healthRef.current = setInterval(() => {
      if (!active) return;
      const last = lastMessageRef.current || 0;
      if (!last) return;
      if (Date.now() - last > 45000) {
        setStatus("disconnected");
        source?.close();
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 1000);
      }
    }, 15000);
    return () => {
      active = false;
      source?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (healthRef.current) clearInterval(healthRef.current);
    };
  }, [usePolling]);

  useEffect(() => {
    if (!usePolling) return;
    let active = true;
    const poll = async () => {
      if (!active) return;
      const since = lastSeenRef.current || new Date(Date.now() - 60 * 1000).toISOString();
      try {
        const res = await fetch(`/api/realtime?since=${encodeURIComponent(since)}&mode=poll`, { cache: "no-store" });
        if (!res.ok) throw new Error("poll_failed");
        const payload = await res.json().catch(() => ({}));
        const events: RealtimeEvent[] = Array.isArray(payload.events) ? payload.events : [];
        handleEvents(events, payload.serverTime);
        setStatus("connected");
        lastMessageRef.current = Date.now();
      } catch {
        setStatus("disconnected");
      }
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [usePolling]);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) =>
      setTimeout(() => {
        setToasts((prev) => prev.filter((p) => p.id !== t.id));
      }, 7000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const pushTestToast = async () => {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        try {
          const ctx = new AudioCtx();
          await ctx.resume();
          ctx.close().catch(() => {});
        } catch {}
      }
      if (!soundEnabledRef.current) {
        soundEnabledRef.current = true;
        soundEnabledStateRef.current = true;
        setSoundEnabled(true);
        try {
          window.localStorage.setItem("apiflujos-realtime-sound", "1");
        } catch {}
      }
      setTimeout(() => playCashSound(), 120);
      const res = await fetch("/api/realtime/test", { method: "POST" });
      if (!res.ok) throw new Error("test_failed");
    } catch {
      const now = new Date().toISOString();
      const fallback: Toast = {
        id: `test_${Date.now()}`,
        type: "system",
        level: "info",
        ts: now,
        title: "Prueba local",
        message: "No se pudo emitir un evento real. Revisa ADMIN_API_TOKEN.",
        seenAt: Date.now()
      };
      setToasts((prev) => [fallback, ...prev].slice(0, 6));
    }
  };

  const statusEl = (
    <div className={`realtime-status is-${status}`}>
      <span className="realtime-status-dot" aria-hidden="true" />
      <span className="realtime-status-text">
        {status === "connected" ? "Tiempo real" : status === "connecting" ? "Conectando" : "Desconectado"}
      </span>
    </div>
  );

  const iconForToast = (toast: Toast) => {
    const kind = String(toast.kind || "").toLowerCase();
    if (kind.includes("payment_approved")) return "payment-ok";
    if (kind.includes("payment_failed")) return "payment-bad";
    if (kind.includes("link")) return "link";
    if (kind.includes("message")) return "message";
    if (kind.includes("job")) return "job";
    if (kind.includes("webhook")) return "webhook";
    if (kind.includes("subscription")) return "subscription";
    return "system";
  };

  const iconLabel = (kind: string) => {
    switch (kind) {
      case "payment-ok":
        return "Pago aprobado";
      case "payment-bad":
        return "Pago fallido";
      case "link":
        return "Link";
      case "message":
        return "Mensaje";
      case "job":
        return "Job";
      case "webhook":
        return "Webhook";
      case "subscription":
        return "Suscripción";
      default:
        return "Sistema";
    }
  };

  return (
    <>
      {slot ? createPortal(statusEl, slot) : null}
      <div className="realtime-toasts" aria-live="polite">
        {!slot ? statusEl : null}
        {toasts.map((toast) => {
          const iconKind = iconForToast(toast);
          const IconTag: any = toast.href ? "a" : "div";
          return (
            <IconTag
              key={toast.id}
              className={`toast ${toast.level === "error" ? "is-error" : "is-info"} ${toast.href ? "is-clickable" : ""}`}
              href={toast.href || undefined}
              data-loader={toast.href ? "off" : undefined}
            >
              <div className={`toast-icon icon-${iconKind}`} aria-label={iconLabel(iconKind)}>
                <span aria-hidden="true">
                  {iconKind === "payment-ok"
                    ? "✓"
                    : iconKind === "payment-bad"
                      ? "!"
                      : iconKind === "message"
                        ? "✉"
                        : iconKind === "link"
                          ? "⛓"
                          : iconKind === "job"
                            ? "⚙"
                            : iconKind === "webhook"
                              ? "↗"
                              : iconKind === "subscription"
                                ? "◎"
                                : "●"}
                </span>
              </div>
              <div className="toast-body">
                <div className="toast-title-row">
                  <div className="toast-title">{toast.title}</div>
                  {toast.badge ? <span className="toast-badge">{toast.badge}</span> : null}
                </div>
                <div className="toast-message">{toast.message}</div>
                <div className="toast-meta">
                  <span>{toast.type === "webhook" ? "Webhook" : toast.type === "job" ? "Job" : "Sistema"}</span>
                  <span>{new Date(toast.ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            </IconTag>
          );
        })}
      </div>
    </>
  );
}
