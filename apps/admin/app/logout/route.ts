import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "../../lib/session";

export async function GET(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3002";
  const baseUrl = `${proto}://${host}`;
  const res = NextResponse.redirect(new URL("/login?loggedOut=1", baseUrl));
  res.cookies.set(ADMIN_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set("sa_session", "", { path: "/", maxAge: 0 });
  return res;
}
