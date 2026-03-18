import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { syncContactsAttributes } from "../../../admin/_services/comms";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const limit = Number(body?.limit || 200);
  const result = await syncContactsAttributes(limit);
  return NextResponse.json(result);
}
