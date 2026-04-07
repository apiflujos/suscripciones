type ChannelPayload = Record<string, unknown>;

type WsClient = {
  readyState?: number;
  send: (data: string) => void;
  subscriptions?: Set<string>;
};

type ServerListener = (payload: ChannelPayload) => void;

type WsHub = {
  wss?: { clients: Set<WsClient> };
  listeners?: Map<string, Set<ServerListener>>;
};

const GLOBAL_KEY = "__WS_HUB__";

function getHub(): WsHub {
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = {};
  if (!g[GLOBAL_KEY].listeners) g[GLOBAL_KEY].listeners = new Map();
  return g[GLOBAL_KEY] as WsHub;
}

export function setWsHub(hub: WsHub) {
  const current = getHub();
  const g = globalThis as any;
  g[GLOBAL_KEY] = {
    ...current,
    ...hub,
    listeners: current.listeners || new Map()
  };
}

export function subscribeToChannel(channel: string, listener: ServerListener) {
  const hub = getHub();
  if (!hub.listeners) hub.listeners = new Map();
  if (!hub.listeners.has(channel)) hub.listeners.set(channel, new Set());
  hub.listeners.get(channel)!.add(listener);
  return () => {
    const next = hub.listeners?.get(channel);
    next?.delete(listener);
    if (next && next.size === 0) hub.listeners?.delete(channel);
  };
}

export function publishToChannel(channel: string, payload: unknown) {
  const hub = getHub();
  const msg = JSON.stringify({ channel, payload, ts: Date.now() });
  let delivered = 0;

  const wss = hub.wss;
  if (wss) {
    for (const client of wss.clients) {
      const subs = client.subscriptions;
      if (subs && subs.has(channel) && client.readyState === 1) {
        try {
          client.send(msg);
          delivered += 1;
        } catch {
          // ignore send errors
        }
      }
    }
  }

  const listeners = hub.listeners?.get(channel);
  if (listeners?.size) {
    for (const listener of listeners) {
      try {
        listener((payload ?? {}) as ChannelPayload);
        delivered += 1;
      } catch {
        // ignore listener errors
      }
    }
  }

  return delivered;
}
