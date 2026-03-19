import path from "path";
import fs from "fs/promises";
import { getMediaDir } from "@suscripciones/core/services/mediaStorage";
import { verifyMediaToken } from "../../../../lib/mediaAuth";
import { normalizeBearer } from "../../../../lib/jwt";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/session";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif"
};

export async function GET(req: Request, ctx: { params: Promise<{ filename: string }> }) {
  const params = await ctx.params;
  const raw = String(params?.filename || "").trim();
  if (!raw) return Response.json({ error: "not_found" }, { status: 404 });

  const safe = path.basename(raw);
  if (safe !== raw) return Response.json({ error: "not_found" }, { status: 404 });

  const url = new URL(req.url);
  const tokenFromQuery = String(url.searchParams.get("token") || "").trim();
  const auth = req.headers.get("authorization") || "";
  const tokenFromHeader = normalizeBearer(auth);
  const token = tokenFromHeader || tokenFromQuery;
  let authorized = false;

  if (token) {
    const claims = await verifyMediaToken(token, safe);
    authorized = Boolean(claims);
  }

  if (!authorized) {
    const cookieStore = await cookies();
    const raw = cookieStore.get(ADMIN_SESSION_COOKIE)?.value || "";
    const session = raw ? await verifyAdminSessionToken(raw) : null;
    authorized = Boolean(session);
  }

  if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });

  const filePath = path.join(getMediaDir(), safe);

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(safe).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] || "application/octet-stream";
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=2592000"
      }
    });
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
