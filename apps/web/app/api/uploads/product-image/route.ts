import { NextResponse } from "next/server";
import { getAdminApiConfig } from "../../../lib/adminApi";
import { assertSameOrigin } from "../../../lib/csrf";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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
  const { apiBase, token } = getAdminApiConfig();
  if (!apiBase || !token) {
    return NextResponse.json({ error: "missing_admin_token" }, { status: 401 });
  }

  const res = await fetch(`${apiBase}/admin/media/product-image`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify({ dataUrl, filename: file.name })
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json({ error: json?.error || "upload_failed", details: json?.message || json }, { status: res.status });
  }

  return NextResponse.json({ url: json?.url || "" });
}
