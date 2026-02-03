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
      // Wompi properties are paths relative to the `data` object (e.g. `transaction.id`)
      return getByPath(dataRoot, p);
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
