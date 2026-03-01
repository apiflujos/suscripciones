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
};

type Toast = RealtimeEvent & { seenAt: number };
type RealtimeStatus = "connecting" | "connected" | "disconnected";

const STORAGE_KEY = "apiflujos-realtime-last";

export function RealtimeNotifier() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const lastSeenRef = useRef<string>("");
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);
  const connectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const soundEnabledRef = useRef(false);
  const soundEnabledStateRef = useRef(false);
  const volumeRef = useRef(0.55);
  const lastSoundRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());

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

  const playCashSound = () => {
    if (typeof window === "undefined") return;
    if (!soundEnabledRef.current) return;
    const nowMs = Date.now();
    if (nowMs - lastSoundRef.current < 3000) return;
    lastSoundRef.current = nowMs;
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    const base = volumeRef.current || 0.55;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.55 * base, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.3);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.35);

    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.0001, now);
    clickGain.gain.exponentialRampToValueAtTime(0.35 * base, now + 0.01);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    clickGain.connect(ctx.destination);

    const clickOsc = ctx.createOscillator();
    clickOsc.type = "triangle";
    clickOsc.frequency.setValueAtTime(1800, now);
    clickOsc.connect(clickGain);
    clickOsc.start(now + 0.05);
    clickOsc.stop(now + 0.12);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 500);
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

  useEffect(() => {
    let source: EventSource | null = null;
    let active = true;

    const connect = () => {
      if (!active) return;
      setStatus("connecting");
      const since = lastSeenRef.current || new Date(Date.now() - 60 * 1000).toISOString();
      source = new EventSource(`/api/realtime?since=${encodeURIComponent(since)}`);
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = setTimeout(() => {
        if (!active) return;
        setStatus("disconnected");
        source?.close();
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 4000);
      }, 7000);

      source.onopen = () => {
        if (!active) return;
        if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
        setStatus("connected");
      };

      source.onmessage = (evt) => {
        if (!evt.data) return;
        const payload = JSON.parse(evt.data || "{}");
        const events: RealtimeEvent[] = Array.isArray(payload.events) ? payload.events : [];
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
        }
      };

      source.onerror = () => {
        if (!active) return;
        if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
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
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
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
      const res = await fetch("/api/realtime/test", { method: "POST" });
      if (!res.ok) throw new Error("test_failed");
      playCashSound();
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
      playFailSound();
    }
  };

  const statusEl = (
    <div className={`realtime-status is-${status}`}>
      <span className="realtime-status-dot" aria-hidden="true" />
      <span className="realtime-status-text">
        {status === "connected" ? "Tiempo real" : status === "connecting" ? "Conectando" : "Desconectado"}
      </span>
      <label className="realtime-sound-toggle">
        <input
          type="checkbox"
          checked={soundEnabled}
          onChange={(e) => {
            const next = e.target.checked;
            soundEnabledRef.current = next;
            soundEnabledStateRef.current = next;
            setSoundEnabled(next);
            try {
              window.localStorage.setItem("apiflujos-realtime-sound", next ? "1" : "0");
            } catch {}
          }}
        />
        <span>Sonido</span>
      </label>
      <input
        className="realtime-volume"
        type="range"
        min="0.1"
        max="1"
        step="0.05"
        value={volume}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          volumeRef.current = v;
          setVolume(v);
          try {
            window.localStorage.setItem("apiflujos-realtime-sound-volume", String(v));
          } catch {}
        }}
        aria-label="Volumen"
      />
      <button className="ghost btn-compact" type="button" onClick={pushTestToast} data-loader="off">
        Probar
      </button>
    </div>
  );

  return (
    <>
      {slot ? createPortal(statusEl, slot) : null}
      <div className="realtime-toasts" aria-live="polite">
        {!slot ? statusEl : null}
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.level === "error" ? "is-error" : "is-info"}`}>
            <div className="toast-title">{toast.title}</div>
            <div className="toast-message">{toast.message}</div>
            <div className="toast-meta">
              <span>{toast.type === "webhook" ? "Webhook" : toast.type === "job" ? "Job" : "Sistema"}</span>
              <span>{new Date(toast.ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
