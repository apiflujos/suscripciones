type ChannelPayload = Record<string, unknown>;

type ServerListener = (payload: ChannelPayload) => void;

type ListenerHub = Map<string, Set<ServerListener>>;

const GLOBAL_KEY = "__WS_HUB__";

function getHub(): ListenerHub {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: ListenerHub };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY] as ListenerHub;
}

export function subscribeToChannel(channel: string, listener: ServerListener) {
  const hub = getHub();
  if (!hub.has(channel)) hub.set(channel, new Set());
  hub.get(channel)!.add(listener);
  return () => {
    const next = hub.get(channel);
    next?.delete(listener);
    if (next && next.size === 0) hub.delete(channel);
  };
}

export function publishToChannel(channel: string, payload: unknown) {
  const hub = getHub();
  const listeners = hub.get(channel);
  let delivered = 0;

  if (!listeners?.size) return delivered;

  for (const listener of listeners) {
    try {
      listener((payload ?? {}) as ChannelPayload);
      delivered += 1;
    } catch {
      // ignore listener errors
    }
  }

  return delivered;
}
