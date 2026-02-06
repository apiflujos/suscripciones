import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "../../lib/authSession";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  const res = NextResponse.redirect(new URL("/login?loggedOut=1", url));
  res.cookies.set(ADMIN_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

