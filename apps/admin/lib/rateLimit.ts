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

export function checkRateLimit(key: string) {
  const windowMs = getWindowMs();
  const max = getMax();
  const now = Date.now();

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
