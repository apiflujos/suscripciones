import { headers } from "next/headers";

export function assertSameOrigin() {
  const origin = headers().get("origin");
  const host = headers().get("host");
  if (!origin || !host) return;
  try {
    const originHost = new URL(origin).host;
    if (originHost && originHost !== host) {
      throw new Error("csrf_blocked");
    }
  } catch (err) {
    throw new Error("csrf_blocked");
  }
}
