import { NextResponse } from "next/server";
import { assertSameOrigin } from "../../../lib/csrf";
import { requireApiSession } from "../../_lib/requireApiSession";
import { uploadProductImage } from "../../../admin/_services/media";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  try {
    await assertSameOrigin();
  } catch {
    return NextResponse.json({ error: "csrf_blocked" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const maxBytes = 2 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;
  try {
    const saved = await uploadProductImage({ req, dataUrl, maxBytes: 2 * 1024 * 1024 });
    return NextResponse.json({ url: saved.url });
  } catch (err: any) {
    return NextResponse.json({ error: "upload_failed", details: String(err?.message || err) }, { status: 400 });
  }
}
