import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./lib/session";
import { CSRF_COOKIE } from "./app/lib/csrf";

export async function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  const pathname = req.nextUrl.pathname;
  requestHeaders.set("x-app-pathname", pathname);

  const existingCsrf = req.cookies.get(CSRF_COOKIE)?.value || "";
  const csrfToken = existingCsrf || crypto.randomUUID();
  requestHeaders.set("x-csrf-token", csrfToken);

  const url = req.nextUrl.clone();
  
  // Normalizar rutas de Super Admin (__sa -> sa)
  const shouldRewriteSa = pathname.startsWith("/__sa");
  if (shouldRewriteSa) {
    url.pathname = pathname.replace(/^\/__sa/, "/sa");
    requestHeaders.set("x-app-pathname", url.pathname); // Actualizar header si reescribimos
  }

  // Definir rutas públicas
  const isPublic =
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname.startsWith("/login/") || // Soporte para sub-rutas de login si las hubiera
    pathname === "/sa/login" ||
    pathname === "/sa/logout" ||
    pathname === "/__sa/login" ||
    pathname === "/__sa/logout" ||
    pathname === "/public" ||
    pathname.startsWith("/public/") ||
    pathname === "/wompi/widget" ||
    pathname === "/404" ||
    pathname === "/500" ||
    pathname === "/_error";

  const isDebugPath = pathname.startsWith("/debug") || pathname.startsWith("/__debug");
  const debugPublic = process.env.NODE_ENV !== "production";

  let session = null;
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
  
  if (token) {
    session = await verifyAdminSessionToken(token);
  }

  // Validación de Autenticación
  if (!isPublic && !(isDebugPath && debugPublic)) {
    if (!session) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }

    const isSuperAdminArea = pathname.startsWith("/sa") || pathname.startsWith("/__sa");
    if (isSuperAdminArea && session.role !== "SUPER_ADMIN") {
      const homeUrl = req.nextUrl.clone();
      homeUrl.pathname = "/";
      homeUrl.searchParams.delete("next");
      return NextResponse.redirect(homeUrl);
    }
  }

  // Inyectar estado de sesión en headers para layout
  if (session) {
    requestHeaders.set("x-auth-user", session.email);
    requestHeaders.set("x-auth-role", session.role);
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
  // Exclude Next internals and any public static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
