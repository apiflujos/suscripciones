import express from "express";
import { z } from "zod";
import { saveDataUrlToFile } from "../services/mediaStorage";
import { getPublicBaseUrlFromEnv } from "../services/publicBase";

const uploadSchema = z.object({
  dataUrl: z.string().min(10),
  filename: z.string().optional()
});

function buildPublicBase(req: express.Request) {
  const envBase = getPublicBaseUrlFromEnv();
  if (envBase) return envBase;
  const host = String(req.header("x-forwarded-host") || req.header("host") || "").trim();
  if (!host) return "";
  const proto = String(req.header("x-forwarded-proto") || req.protocol || "https").trim();
  return `${proto}://${host}`;
}

export const mediaRouter = express.Router();

mediaRouter.post("/product-image", async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  try {
    const maxBytes = 2 * 1024 * 1024;
    const saved = await saveDataUrlToFile(parsed.data.dataUrl, "product", maxBytes);
    const base = buildPublicBase(req);
    const url = base ? `${base}/public/media/${saved.filename}` : `/public/media/${saved.filename}`;
    res.json({ ok: true, url, bytes: saved.bytes, mime: saved.mime });
  } catch (err: any) {
    res.status(400).json({ error: "upload_failed", message: String(err?.message || err) });
  }
});
