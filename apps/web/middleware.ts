import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./lib/session";
import { CSRF_COOKIE } from "./app/lib/csrf";

// Rutas que NO requieren autenticación
const PUBLIC_PATHS = [
  "/login",
  "/logout",
  "/public",
  "/wompi/widget",
  "/404",
  "/500",
  "/_error"
];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/public/") ||
    pathname.startsWith("/login/")
  );
}

function isSuperAdminArea(pathname: string): boolean {
  return pathname.startsWith("/sa") || pathname.startsWith("/__sa");
}

function isSettingsArea(pathname: string): boolean {
  return pathname.startsWith("/settings");
}

function isLogsArea(pathname: string): boolean {
  return pathname.startsWith("/logs");
}

export async function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  const pathname = req.nextUrl.pathname;
  requestHeaders.set("x-app-pathname", pathname);

  // CSRF Token
  const existingCsrf = req.cookies.get(CSRF_COOKIE)?.value || "";
  const csrfToken = existingCsrf || crypto.randomUUID();
  requestHeaders.set("x-csrf-token", csrfToken);

  // Normalizar rutas de Super Admin (__sa -> sa)
  const shouldRewriteSa = pathname.startsWith("/__sa");
  const url = shouldRewriteSa
    ? new URL(req.nextUrl.origin + pathname.replace(/^\/__sa/, "/sa") + req.nextUrl.search)
    : req.nextUrl.clone();

  if (shouldRewriteSa) {
    requestHeaders.set("x-app-pathname", url.pathname);
  }

  // Debug paths (solo en desarrollo)
  const isDebugPath = pathname.startsWith("/debug") || pathname.startsWith("/__debug");
  const isDebugPublic = process.env.NODE_ENV !== "production";

  // Verificar sesión
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = token ? await verifyAdminSessionToken(token) : null;

  // PROTECCIÓN DE RUTAS
  const isProtectedRoute = !isPublicPath(pathname) && !(isDebugPath && isDebugPublic);

  if (isProtectedRoute && !session) {
    // Redirigir al login
    const loginUrl = new URL(req.nextUrl.origin + "/login");
    loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // VALIDACIÓN DE ROLES
  if (session) {
    // Super Admin area: solo SUPER_ADMIN
    if (isSuperAdminArea(pathname) && session.role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL(req.nextUrl.origin + "/"));
    }

    // Settings area: AGENTS no pueden acceder
    if (isSettingsArea(pathname) && session.role === "AGENT") {
      return NextResponse.redirect(new URL(req.nextUrl.origin + "/"));
    }

    // Logs area: solo SUPER_ADMIN
    if (isLogsArea(pathname) && session.role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL(req.nextUrl.origin + "/"));
    }

    // Inyectar información de sesión en headers
    requestHeaders.set("x-auth-user", session.email);
    requestHeaders.set("x-auth-role", session.role);
    if (session.tenantId) {
      requestHeaders.set("x-auth-tenant-id", session.tenantId);
    }
  }

  // Construir respuesta
  const response = shouldRewriteSa
    ? NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });

  // CSRF Cookie
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
