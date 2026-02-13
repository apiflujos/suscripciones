import { headers } from "next/headers";

export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
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
