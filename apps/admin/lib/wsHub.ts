type WsClient = {
  readyState?: number;
  send: (data: string) => void;
  subscriptions?: Set<string>;
};

type WsHub = {
  wss?: { clients: Set<WsClient> };
};

const GLOBAL_KEY = "__WS_HUB__";

function getHub(): WsHub {
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = {};
  return g[GLOBAL_KEY] as WsHub;
}

export function setWsHub(hub: WsHub) {
  const g = globalThis as any;
  g[GLOBAL_KEY] = hub;
}

export function publishToChannel(channel: string, payload: unknown) {
  const hub = getHub();
  const wss = hub.wss;
  if (!wss) return 0;
  const msg = JSON.stringify({ channel, payload, ts: Date.now() });
  let delivered = 0;
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
  return delivered;
}
