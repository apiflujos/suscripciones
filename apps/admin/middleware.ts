import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./lib/session";

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

  if (!isPublic) {
    const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
    const session = await verifyAdminSessionToken(token);
    if (!session) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("next", `${req.nextUrl.pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    const isSuperAdminArea = pathname === "/__sa" || pathname.startsWith("/__sa/") || pathname === "/sa" || pathname.startsWith("/sa/");
    if (isSuperAdminArea && session.role !== "SUPER_ADMIN") {
      const homeUrl = req.nextUrl.clone();
      homeUrl.pathname = "/";
      homeUrl.searchParams.delete("next");
      return NextResponse.redirect(homeUrl);
    }
  }

  return shouldRewriteSa
    ? NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Exclude Next internals and any public static files (e.g. /styles.css, /brand/logo.png).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
