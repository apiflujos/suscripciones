const GLOBAL_KEY = "__WS_HUB__";

function getHub() {
  if (!globalThis[GLOBAL_KEY]) globalThis[GLOBAL_KEY] = {};
  if (!globalThis[GLOBAL_KEY].listeners) globalThis[GLOBAL_KEY].listeners = new Map();
  return globalThis[GLOBAL_KEY];
}

function setWsHub(hub) {
  const current = getHub();
  globalThis[GLOBAL_KEY] = {
    ...current,
    ...hub,
    listeners: current.listeners || new Map()
  };
}

function subscribeToChannel(channel, listener) {
  const hub = getHub();
  if (!hub.listeners.has(channel)) hub.listeners.set(channel, new Set());
  hub.listeners.get(channel).add(listener);
  return () => {
    const next = hub.listeners.get(channel);
    if (!next) return;
    next.delete(listener);
    if (next.size === 0) hub.listeners.delete(channel);
  };
}

function publishToChannel(channel, payload) {
  const hub = getHub();
  const wss = hub.wss;
  const msg = JSON.stringify({ channel, payload, ts: Date.now() });
  let delivered = 0;
  if (wss) {
    for (const client of wss.clients) {
      const subs = client.subscriptions;
      if (subs && subs.has(channel) && client.readyState === 1) {
        try {
          client.send(msg);
          delivered += 1;
        } catch {}
      }
    }
  }
  const listeners = hub.listeners.get(channel);
  if (listeners && listeners.size) {
    for (const listener of listeners) {
      try {
        listener(payload || {});
        delivered += 1;
      } catch {}
    }
  }
  return delivered;
}

module.exports = { setWsHub, subscribeToChannel, publishToChannel };
