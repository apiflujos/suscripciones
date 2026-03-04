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
  meta?: any;
};

type StoredNotification = RealtimeEvent & {
  duplicateCount?: number;
  dedupeKey?: string;
};

type Toast = RealtimeEvent & { seenAt: number };
type RealtimeStatus = "connecting" | "connected" | "disconnected";

const STORAGE_KEY = "apiflujos-realtime-last";
const NOTIFICATIONS_STORAGE_KEY = "apiflujos-notifications-feed";
const CASH_SOUND_SRC = "/brand/cashier.mp3";

function normalizeNotifText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function notificationDedupeKey(event: Partial<RealtimeEvent>) {
  const title = normalizeNotifText(event.title);
  const message = normalizeNotifText(event.message);
  const href = normalizeNotifText(event.href);
  const kind = normalizeNotifText(event.kind);
  const level = normalizeNotifText(event.level);
  const type = normalizeNotifText(event.type);
  return `${type}|${level}|${kind}|${title}|${message}|${href}`;
}

function toStoredNotification(event: RealtimeEvent): StoredNotification {
  const dedupeKey = notificationDedupeKey(event);
  return {
    ...event,
    id: dedupeKey,
    dedupeKey,
    duplicateCount: 1
  };
}

function mergeNotificationFeed(incoming: RealtimeEvent[], existing: StoredNotification[]) {
  const byKey = new Map<string, StoredNotification>();
  const ordered: string[] = [];
  const add = (raw: StoredNotification | RealtimeEvent) => {
    const item: StoredNotification = "dedupeKey" in raw ? (raw as StoredNotification) : toStoredNotification(raw as RealtimeEvent);
    const key = String(item.dedupeKey || notificationDedupeKey(item));
    if (!key) return;
    const prev = byKey.get(key);
    const prevTs = prev ? new Date(prev.ts).getTime() : Number.NaN;
    const nextTs = new Date(item.ts).getTime();
    const prevCount = Math.max(1, Number(prev?.duplicateCount || 1));
    const nextCount = Math.max(1, Number(item?.duplicateCount || 1));
    const mergedCount = prev ? prevCount + nextCount : nextCount;
    if (!prev) {
      byKey.set(key, { ...item, id: key, dedupeKey: key, duplicateCount: mergedCount });
      ordered.push(key);
      return;
    }
    const useIncoming = Number.isFinite(nextTs) && (!Number.isFinite(prevTs) || nextTs >= prevTs);
    byKey.set(key, {
      ...(useIncoming ? item : prev),
      id: key,
      dedupeKey: key,
      duplicateCount: mergedCount
    });
  };
  for (const item of incoming) add(item);
  for (const item of existing) add(item);
  const merged = ordered.map((key) => byKey.get(key)).filter(Boolean) as StoredNotification[];
  merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return merged.slice(0, 80);
}

export function RealtimeNotifier() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [usePolling, setUsePolling] = useState(false);
  const lastSeenRef = useRef<string>("");
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);
  const errorCountRef = useRef(0);
  const sourceRef = useRef<EventSource | null>(null);
  const statusRef = useRef<RealtimeStatus>("connecting");
  const soundEnabledRef = useRef(false);
  const soundEnabledStateRef = useRef(false);
  const volumeRef = useRef(0.55);
  const lastSoundRef = useRef(0);
  const cashAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioPrimedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastMessageRef = useRef<number>(0);
  const lastOkRef = useRef<number>(0);
  const healthRef = useRef<NodeJS.Timeout | null>(null);

  const [soundEnabled, setSoundEnabled] = useState(false);
  const [volume, setVolume] = useState(0.55);

  const lastSeen = useMemo(() => {
    if (typeof window === "undefined") return "";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved || "";
  }, []);

  const primeAudio = () => {
    if (typeof window === "undefined") return;
    if (audioPrimedRef.current) return;
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
      audioPrimedRef.current = true;
      setTimeout(() => ctx.close().catch(() => {}), 120);
    } catch {}
  };

  const primeCashFile = () => {
    const audio = getCashAudio();
    if (!audio) return;
    const prevVol = audio.volume || 0.6;
    audio.volume = 0.02;
    const p = audio.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = prevVol;
      }).catch(() => {
        audio.volume = prevVol;
      });
    }
  };

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
    const enable = () => {
      soundEnabledRef.current = true;
      if (!soundEnabledStateRef.current) {
        soundEnabledStateRef.current = true;
        setSoundEnabled(true);
      }
      primeAudio();
      primeCashFile();
      try {
        window.localStorage.setItem("apiflujos-realtime-sound", "1");
      } catch {}
    };
    document.addEventListener("pointerdown", enable, { once: true });
    return () => document.removeEventListener("pointerdown", enable);
  }, []);

  const getCashAudio = () => {
    if (typeof window === "undefined") return null;
    if (!cashAudioRef.current) {
      const audio = new Audio(CASH_SOUND_SRC);
      audio.preload = "auto";
      try {
        audio.load();
      } catch {}
      cashAudioRef.current = audio;
    }
    return cashAudioRef.current;
  };

  const setStatusSafe = (next: RealtimeStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const markConnected = () => {
    setStatusSafe("connected");
    lastMessageRef.current = Date.now();
    lastOkRef.current = lastMessageRef.current;
  };

  const markConnecting = () => {
    const readyState = sourceRef.current?.readyState;
    if (readyState === EventSource.OPEN) {
      setStatusSafe("connected");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStatusSafe("disconnected");
      return;
    }
    setStatusSafe("connecting");
  };

  const playCashSynth = (base: number) => {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    ctx.resume().catch(() => {});
    const now = ctx.currentTime;

    const playTone = (
      type: OscillatorType,
      startFreq: number,
      endFreq: number,
      startAt: number,
      duration: number,
      gainLevel: number
    ) => {
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

  const playCashSound = (force = false) => {
    if (typeof window === "undefined") return;
    if (force) primeAudio();
    if (!soundEnabledRef.current && !force) return;
    const nowMs = Date.now();
    if (!force && nowMs - lastSoundRef.current < 3000) return;
    lastSoundRef.current = nowMs;
    const base = volumeRef.current || 0.55;
    const audio = getCashAudio();
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.load();
      } catch {}
      audio.volume = base;
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => playCashSynth(base));
      }
      return;
    }
    playCashSynth(base);
  };

  const playFailSound = () => {
    if (typeof window === "undefined") return;
    primeAudio();
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
    lastMessageRef.current = Date.now();
    let shouldPlayCash = false;
    let shouldPlayFail = false;
    let forceCash = false;
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
    if (freshEvents.length) {
      try {
        const existingRaw = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
        const parsedExisting = existingRaw ? JSON.parse(existingRaw) : [];
        const existing = Array.isArray(parsedExisting) ? (parsedExisting as StoredNotification[]) : [];
        const merged = mergeNotificationFeed(freshEvents, existing);
        window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(merged));
        window.dispatchEvent(
          new CustomEvent("apiflujos:notifications-updated", { detail: { count: merged.length, items: merged } })
        );
      } catch {}
      for (const e of freshEvents) {
        if (e.kind === "ai_response" || e.kind === "ai_failed") {
          try {
            window.dispatchEvent(new CustomEvent("apiflujos:ai-response", { detail: e.meta || e }));
          } catch {}
        }
        if (e.sound === "cash") {
          shouldPlayCash = true;
          try {
            window.dispatchEvent(new CustomEvent("apiflujos:payment-approved", { detail: e }));
          } catch {}
        }
        if (e.badge === "Prueba") {
          forceCash = true;
          if (!soundEnabledRef.current) {
            soundEnabledRef.current = true;
            soundEnabledStateRef.current = true;
            setSoundEnabled(true);
            try {
              window.localStorage.setItem("apiflujos-realtime-sound", "1");
            } catch {}
          }
        }
        if (e.sound === "fail") shouldPlayFail = true;
      }
      setToasts((prev) => {
        const uniqueFresh = mergeNotificationFeed(freshEvents, []).slice(0, 6);
        const merged = [...uniqueFresh.map((e) => ({ ...e, seenAt: now })), ...prev];
        return merged.slice(0, 6);
      });
      if (shouldPlayCash) playCashSound(forceCash);
      if (shouldPlayFail && !shouldPlayCash) playFailSound();
    }

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
      markConnecting();
      const since = lastSeenRef.current || new Date(Date.now() - 60 * 1000).toISOString();
      source = new EventSource(`/api/realtime?since=${encodeURIComponent(since)}`);
      sourceRef.current = source;
      source.onopen = () => {
        if (!active) return;
        errorCountRef.current = 0;
        markConnected();
      };

      source.onmessage = (evt) => {
        if (!evt.data) return;
        let payload: any = {};
        try {
          payload = JSON.parse(evt.data || "{}");
        } catch {
          markConnected();
          return;
        }
        const events: RealtimeEvent[] = Array.isArray(payload.events) ? payload.events : [];
        handleEvents(events, payload.serverTime);
        markConnected();
      };

      source.onerror = () => {
        if (!active) return;
        markConnecting();
        const readyState = source?.readyState;
        source?.close();
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        if (readyState === EventSource.CLOSED || readyState == null) {
          errorCountRef.current += 1;
          if (errorCountRef.current >= 1) {
            setUsePolling(true);
            markConnecting();
            return;
          }
          reconnectRef.current = setTimeout(connect, 4000);
        }
      };
    };

    connect();
    if (healthRef.current) clearInterval(healthRef.current);
    healthRef.current = setInterval(() => {
      if (!active) return;
      const readyState = sourceRef.current?.readyState;
      if (readyState === EventSource.CLOSED) {
        markConnecting();
        source?.close();
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 1000);
        return;
      }
      if (readyState === EventSource.OPEN) {
        setStatusSafe("connected");
      }
    }, 15000);
    return () => {
      active = false;
      source?.close();
      sourceRef.current = null;
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
        markConnected();
      } catch {
        markConnecting();
      }
    };
    poll();
    const id = setInterval(poll, 8000);
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
      if (!soundEnabledRef.current) {
        soundEnabledRef.current = true;
        soundEnabledStateRef.current = true;
        setSoundEnabled(true);
        try {
          window.localStorage.setItem("apiflujos-realtime-sound", "1");
        } catch {}
      }
      primeAudio();
      primeCashFile();
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__apiflujosRealtimeTest = () => {
      pushTestToast();
    };
    return () => {
      delete (window as any).__apiflujosRealtimeTest;
    };
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
    if (kind.includes("ai")) return "ai";
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
      case "ai":
        return "IA";
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
                      : iconKind === "ai"
                        ? "✦"
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
