import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { uploadProductImage } from "../../_services/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadSchema = z.object({
  dataUrl: z.string().min(10),
  filename: z.string().optional()
});

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const saved = await uploadProductImage({ req, dataUrl: parsed.data.dataUrl, maxBytes: 2 * 1024 * 1024 });
    return Response.json({ ok: true, url: saved.url, bytes: saved.bytes, mime: saved.mime });
  } catch (err: any) {
    return Response.json({ error: "upload_failed", message: String(err?.message || err) }, { status: 400 });
  }
}
