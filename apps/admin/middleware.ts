import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, computeAdminSessionToken } from "./lib/authSession";

export async function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-app-pathname", req.nextUrl.pathname);

  const url = req.nextUrl.clone();
  const shouldRewriteSa = url.pathname === "/__sa" || url.pathname.startsWith("/__sa/");
  if (shouldRewriteSa) {
    url.pathname = url.pathname.replace(/^\/__sa(?=\/|$)/, "/sa");
  }

  const pathname = req.nextUrl.pathname;
  const isPublic =
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname === "/sa/login" ||
    pathname === "/sa/logout" ||
    pathname === "/__sa/login" ||
    pathname === "/__sa/logout";

  const isSuperAdminArea = pathname === "/__sa" || pathname.startsWith("/__sa/") || pathname === "/sa" || pathname.startsWith("/sa/");

  const expected = await computeAdminSessionToken();
  const requiresAdminSession = Boolean(expected) && !isPublic && !isSuperAdminArea;

  if (requiresAdminSession) {
    const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
    if (token !== expected) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("next", `${req.nextUrl.pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }
  }

  return shouldRewriteSa
    ? NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
