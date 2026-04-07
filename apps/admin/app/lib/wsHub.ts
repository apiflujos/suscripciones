/**
 * Realtime Hub en cliente.
 *
 * Mantiene suscriptores en memoria para componentes del frontend y
 * también despacha eventos custom del navegador por canal.
 *
 * Uso:
 * import { publishToChannel } from "@/app/lib/wsHub";
 * publishToChannel("notifications", { type: "MESSAGE_SENT" });
 */

type ChannelPayload = Record<string, unknown>;

const channels = new Map<string, Set<(payload: ChannelPayload) => void>>();

export function subscribeToChannel(channel: string, callback: (payload: ChannelPayload) => void) {
  if (!channels.has(channel)) {
    channels.set(channel, new Set());
  }
  channels.get(channel)!.add(callback);

  return () => {
    channels.get(channel)?.delete(callback);
  };
}

export function publishToChannel(channel: string, payload: ChannelPayload): boolean {
  const subscribers = channels.get(channel);
  if (!subscribers || subscribers.size === 0) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(`apiflujos:${channel}`, { detail: payload }));
    }
    return false;
  }

  subscribers.forEach((callback) => {
    try {
      callback(payload);
    } catch (err) {
      console.error(`Error in channel ${channel} subscriber:`, err);
    }
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(`apiflujos:${channel}`, { detail: payload }));
  }

  return true;
}

export function getSubscriberCount(channel: string): number {
  return channels.get(channel)?.size || 0;
}
