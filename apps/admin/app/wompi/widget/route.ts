import { NextResponse } from "next/server";

export async function GET() {
  const res = await fetch("https://checkout.wompi.co/widget.js", { cache: "no-store" });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
