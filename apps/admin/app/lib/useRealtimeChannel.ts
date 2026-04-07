"use client";

import { useEffect, useRef, useState } from "react";

export type RealtimeConnectionStatus = "connecting" | "connected" | "disconnected";

type UseRealtimeChannelArgs = {
  channel: string;
  enabled?: boolean;
  pollIntervalMs?: number;
  statusEventName?: string;
  onSnapshot?: () => void | Promise<void>;
  onMessage?: (payload: unknown) => void | Promise<void>;
};

function emitStatus(eventName: string | undefined, status: RealtimeConnectionStatus, channel: string) {
  if (!eventName || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: { status, channel } }));
}

export function useRealtimeChannel(args: UseRealtimeChannelArgs) {
  const { channel, enabled = true, pollIntervalMs = 20000, statusEventName, onSnapshot, onMessage } = args;
  const [status, setStatus] = useState<RealtimeConnectionStatus>(enabled ? "connecting" : "disconnected");
  const snapshotRef = useRef(args.onSnapshot);
  const messageRef = useRef(args.onMessage);

  useEffect(() => {
    snapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    messageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled) {
      setStatus("disconnected");
      emitStatus(statusEventName, "disconnected", channel);
      return;
    }

    let running = true;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const updateStatus = (next: RealtimeConnectionStatus) => {
      if (!running) return;
      setStatus((prev) => (prev === next ? prev : next));
      emitStatus(statusEventName, next, channel);
    };

    const runSnapshot = async () => {
      try {
        await snapshotRef.current?.();
      } catch {
        // ignore callback errors to preserve transport lifecycle
      }
    };

    const startPolling = () => {
      if (timer) return;
      updateStatus("disconnected");
      void runSnapshot();
      timer = setInterval(() => {
        void runSnapshot();
      }, pollIntervalMs);
    };

    const stopPolling = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    updateStatus("connecting");

    try {
      es = new EventSource(`/api/realtime?channel=${encodeURIComponent(channel)}`, { withCredentials: true });
      es.addEventListener("ready", () => {
        stopPolling();
        updateStatus("connected");
        void runSnapshot();
      });
      es.addEventListener("message", (event) => {
        let payload: unknown = null;
        try {
          payload = JSON.parse((event as MessageEvent<string>).data || "null");
        } catch {
          payload = null;
        }
        void messageRef.current?.(payload);
      });
      es.onerror = () => {
        startPolling();
      };
    } catch {
      startPolling();
    }

    void runSnapshot();

    return () => {
      running = false;
      stopPolling();
      es?.close();
    };
  }, [channel, enabled, pollIntervalMs, statusEventName]);

  return status;
}
