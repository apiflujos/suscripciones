import { sha256Hex } from "./crypto";

export function tokenMeta(token: string) {
  const raw = String(token || "").trim();
  if (!raw) return {};
  const hash = sha256Hex(raw);
  return {
    tokenHash: hash,
    tokenPrefix: raw.slice(0, 4),
    tokenSuffix: raw.slice(-4)
  };
}
