import { sha256Hex, timingSafeEqualHex } from "../../lib/crypto";
import type { WompiEvent } from "./types";

function getByPath(obj: unknown, path: string): string {
  const parts = path.split(".").filter(Boolean);
  let current: any = obj as any;
  for (const part of parts) {
    if (current == null) return "";
    current = current[part];
  }
  if (current == null) return "";
  if (typeof current === "string") return current;
  if (typeof current === "number" || typeof current === "bigint" || typeof current === "boolean") return String(current);
  return JSON.stringify(current);
}

export function computeWompiChecksum(event: WompiEvent, eventsSecret: string): string {
  const dataRoot = (event as any).data;
  const concatenated = (event.signature?.properties ?? [])
    .map((p) => {
      // Compatibilidad: Wompi ha usado rutas relativas (`transaction.id`) y absolutas (`data.transaction.id`).
      const path = String(p || "").trim();
      if (!path) return "";
      const rel = getByPath(dataRoot, path);
      if (rel) return rel;
      const abs = getByPath(event as any, path);
      if (abs) return abs;
      if (path.startsWith("data.")) return getByPath(dataRoot, path.slice(5));
      return getByPath(event as any, `data.${path}`);
    })
    .join("");

  return sha256Hex(`${concatenated}${event.timestamp}${eventsSecret}`);
}

export function verifyWompiSignature(args: {
  event: WompiEvent;
  eventsSecret: string;
  checksumHeader?: string | undefined;
}): { ok: true } | { ok: false; reason: string } {
  const expected = computeWompiChecksum(args.event, args.eventsSecret);
  const provided = args.checksumHeader?.trim() || args.event.signature?.checksum?.trim();
  if (!provided) return { ok: false, reason: "missing checksum" };
  if (!timingSafeEqualHex(expected, provided)) return { ok: false, reason: "checksum mismatch" };
  return { ok: true };
}
