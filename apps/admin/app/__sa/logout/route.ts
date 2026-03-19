import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const headers = req.headers;
  const proto = headers.get("x-forwarded-proto") || "http";
  const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3002";
  const baseUrl = `${proto}://${host}`;
  const res = NextResponse.redirect(new URL("/login?loggedOut=1", baseUrl));
  res.cookies.set("sa_session", "", { path: "/", maxAge: 0 });
  res.cookies.set("sa_session", "", { path: "/__sa", maxAge: 0 });
  return res;
}
