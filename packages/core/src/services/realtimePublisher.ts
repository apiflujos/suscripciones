type RealtimePayload = Record<string, unknown>;

export async function publishRealtime(channel: "payments" | "logs" | "jobs" | "notifications", payload: RealtimePayload) {
  const url = String(process.env.REALTIME_PUBLISH_URL || "").trim();
  const token = String(process.env.REALTIME_PUBLISH_TOKEN || "").trim();
  if (!url || !token) return { ok: false, skipped: true };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": token
      },
      body: JSON.stringify({ channel, payload })
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
