import crypto from "node:crypto";

export function generateWebhookSecret(bytes = 18): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashWebhookSecret(secret: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(secret, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

export function verifyWebhookSecret(secret: string, salt: string, expectedHash: string): boolean {
  const hash = crypto.pbkdf2Sync(secret, salt, 120000, 32, "sha256").toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
