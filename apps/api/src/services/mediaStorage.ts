import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

export function getMediaDir() {
  const raw = String(process.env.MEDIA_DIR || "").trim();
  if (raw) return path.resolve(raw);
  return path.resolve(process.cwd(), "media");
}

export async function ensureMediaDir() {
  await fs.mkdir(getMediaDir(), { recursive: true });
}

export function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer; ext: string } {
  const trimmed = String(dataUrl || "").trim();
  const match = /^data:([^;]+);base64,([a-zA-Z0-9+/=]+)$/.exec(trimmed);
  if (!match) {
    throw new Error("invalid_data_url");
  }
  const mime = match[1].toLowerCase();
  const ext = ALLOWED_MIME[mime];
  if (!ext) throw new Error("unsupported_mime");
  const buffer = Buffer.from(match[2], "base64");
  return { mime, buffer, ext };
}

export async function saveDataUrlToFile(dataUrl: string, prefix: string, maxBytes?: number) {
  const parsed = parseDataUrl(dataUrl);
  if (maxBytes && parsed.buffer.length > maxBytes) {
    throw new Error("file_too_large");
  }
  await ensureMediaDir();
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.${parsed.ext}`;
  const filePath = path.join(getMediaDir(), name);
  await fs.writeFile(filePath, parsed.buffer);
  return { filename: name, bytes: parsed.buffer.length, mime: parsed.mime };
}
