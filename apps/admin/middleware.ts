import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./lib/session";
import { CSRF_COOKIE } from "./app/lib/csrf";

export async function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-app-pathname", req.nextUrl.pathname);
  const existingCsrf = req.cookies.get(CSRF_COOKIE)?.value || "";
  const csrfToken = existingCsrf || crypto.randomUUID();
  requestHeaders.set("x-csrf-token", csrfToken);

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

  const isDebugPath = pathname === "/debug" || pathname === "/__debug";
  const debugPublic = process.env.NODE_ENV !== "production";

  if (!isPublic && !(isDebugPath && debugPublic)) {
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

  const response = shouldRewriteSa
    ? NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });

  if (!existingCsrf) {
    response.cookies.set(CSRF_COOKIE, csrfToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    });
  }

  return response;
}

export const config = {
  // Exclude Next internals and any public static files (e.g. /styles.css, /brand/logo.png).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
