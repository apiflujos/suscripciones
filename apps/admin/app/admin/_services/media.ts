import "server-only";

import { saveDataUrlToFile } from "@suscripciones/core/services/mediaStorage";
import { getPublicBaseUrlFromEnv } from "@suscripciones/core/services/publicBase";

function buildPublicBase(req: Request) {
  const envBase = getPublicBaseUrlFromEnv();
  if (envBase) return envBase;
  const host = String(req.headers.get("x-forwarded-host") || req.headers.get("host") || "").trim();
  if (!host) return "";
  const proto = String(req.headers.get("x-forwarded-proto") || "https").trim();
  return `${proto}://${host}`;
}

export async function uploadProductImage(args: { req: Request; dataUrl: string; maxBytes?: number }) {
  const maxBytes = Number.isFinite(args.maxBytes) ? Math.max(1, Math.trunc(args.maxBytes || 0)) : 2 * 1024 * 1024;
  const saved = await saveDataUrlToFile(args.dataUrl, "product", maxBytes);
  const base = buildPublicBase(args.req);
  const url = base ? `${base}/public/media/${saved.filename}` : `/public/media/${saved.filename}`;
  return { url, bytes: saved.bytes, mime: saved.mime };
}
