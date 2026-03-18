const GLOBAL_KEY = "__WS_HUB__";

function getHub() {
  if (!globalThis[GLOBAL_KEY]) globalThis[GLOBAL_KEY] = {};
  return globalThis[GLOBAL_KEY];
}

function setWsHub(hub) {
  globalThis[GLOBAL_KEY] = hub;
}

function publishToChannel(channel, payload) {
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
      } catch {}
    }
  }
  return delivered;
}

module.exports = { setWsHub, publishToChannel };
