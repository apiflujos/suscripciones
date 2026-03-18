type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function getWindowMs() {
  const raw = Number(process.env.RATE_LIMIT_WINDOW_MS || "600000");
  return Number.isFinite(raw) && raw > 0 ? raw : 600000;
}

function getMax() {
  const raw = Number(process.env.RATE_LIMIT_MAX || "600");
  return Number.isFinite(raw) && raw > 0 ? raw : 600;
}

async function checkRateLimitUpstash(key: string, windowMs: number, max: number) {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token) return null;

  const encoded = encodeURIComponent(key);
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const incrRes = await fetch(`${url}/incr/${encoded}`, { headers, cache: "no-store" as RequestCache });
    const incrJson = await incrRes.json().catch(() => null);
    const count = Number(incrJson?.result || 0);
    if (!Number.isFinite(count)) return null;
    if (count === 1) {
      const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
      await fetch(`${url}/expire/${encoded}/${windowSec}`, { headers, cache: "no-store" as RequestCache }).catch(() => null);
    }
    if (count > max) {
      return { ok: false, remaining: 0, resetAt: Date.now() + windowMs };
    }
    return { ok: true, remaining: Math.max(0, max - count), resetAt: Date.now() + windowMs };
  } catch {
    return null;
  }
}

export async function checkRateLimit(key: string) {
  const windowMs = getWindowMs();
  const max = getMax();
  const now = Date.now();

  const upstash = await checkRateLimitUpstash(key, windowMs, max);
  if (upstash) return upstash;

  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, resetAt: now + windowMs };
  }

  if (existing.count >= max) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { ok: true, remaining: max - existing.count, resetAt: existing.resetAt };
}
