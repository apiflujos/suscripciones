import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./lib/session";
import { CSRF_COOKIE } from "./app/lib/csrf";
import { signJwt, verifyJwt, normalizeBearer } from "./lib/jwt";
import { permissionsForPath, hasPermissions } from "./lib/rbac";
import { checkRateLimit } from "./lib/rateLimit";
import { verifyPublicToken } from "./lib/publicTokens";

const PUBLIC_PATHS = ["/login", "/logout", "/public", "/wompi/widget", "/404", "/500", "/_error"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/public/") || pathname.startsWith("/login/");
}

function isApiPath(pathname: string): boolean {
  return (
    pathname === "/health" ||
    pathname === "/healthz" ||
    pathname.startsWith("/health/") ||
    pathname.startsWith("/healthz/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/webhooks" ||
    pathname.startsWith("/webhooks/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
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

function getClientIp(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  return forwarded.split(",")[0].trim() || "unknown";
}

function allowedOrigins() {
  const raw = String(process.env.CORS_ALLOWED_ORIGINS || "").trim();
  if (!raw) return [] as string[];
  return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

function applySecurityHeaders(res: NextResponse, pathname: string) {
  if (String(process.env.SECURITY_HEADERS_ENABLED || "1").trim() === "0") return res;
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  const hstsAge = String(process.env.HSTS_MAX_AGE || "63072000");
  res.headers.set("Strict-Transport-Security", `max-age=${hstsAge}; includeSubDomains; preload`);

  const allowUnsafeInline = String(process.env.CSP_ALLOW_UNSAFE_INLINE || "1").trim() === "1";
  const allowUnsafeInlinePublic = String(process.env.CSP_PUBLIC_ALLOW_UNSAFE_INLINE || "0").trim() === "1";
  const isPublic = pathname.startsWith("/public/") || pathname.startsWith("/wompi/");
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");
  const unsafe = isPublic ? allowUnsafeInlinePublic : allowUnsafeInline;
  // Next.js requiere inline scripts (hydration). Si quieres CSP estricto, implementar nonces.
  const scriptUnsafe = true;
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `script-src 'self'${scriptUnsafe ? " 'unsafe-inline'" : ""}`,
    "connect-src 'self' https: ws: wss:",
    "frame-ancestors 'none'"
  ].join("; ");
  res.headers.set("Content-Security-Policy", csp);

  return res;
}

export async function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  const pathname = req.nextUrl.pathname;
  requestHeaders.set("x-app-pathname", pathname);

  // Allow Next.js static assets and public files without auth checks.
  if (pathname.startsWith("/_next/") || pathname.startsWith("/favicon") || pathname.startsWith("/robots.txt")) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    return applySecurityHeaders(res, pathname);
  }

  const isApi = isApiPath(pathname);

  if (isApi) {
    const origin = req.headers.get("origin") || "";
    if (origin) {
      const allowed = allowedOrigins();
      if (allowed.length && !allowed.includes(origin)) {
        return new NextResponse(JSON.stringify({ error: "cors_blocked" }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    if (req.method === "OPTIONS") {
      const res = new NextResponse(null, { status: 204 });
      const allowOrigin = origin || "*";
      res.headers.set("Access-Control-Allow-Origin", allowOrigin);
      res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.headers.set("Access-Control-Allow-Headers", "Authorization, X-Auth-Token, Content-Type");
      res.headers.set("Access-Control-Max-Age", "600");
      return applySecurityHeaders(res, pathname);
    }

    const ip = getClientIp(req);
    const key = `${ip}:${pathname.split("/")[1] || "root"}`;
    const rate = await checkRateLimit(key);
    if (!rate.ok) {
      return new NextResponse(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)))
        }
      });
    }

    const authBypass =
      pathname === "/health" ||
      pathname === "/healthz" ||
      pathname.startsWith("/health/") ||
      pathname.startsWith("/healthz/") ||
      pathname === "/admin/auth/login" ||
      pathname === "/admin/sa/login" ||
      pathname === "/admin/sa/refresh" ||
      pathname === "/admin/sa/bootstrap";
    if (authBypass) {
      const bootstrapToken = String(process.env.BOOTSTRAP_TOKEN || "").trim();
      if (bootstrapToken) {
        const provided = req.headers.get("x-bootstrap-token") || "";
        if (provided !== bootstrapToken) {
          const res = new NextResponse(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
          return applySecurityHeaders(res, pathname);
        }
      }
      const res = NextResponse.next({ request: { headers: requestHeaders } });
      const allowOrigin = origin || "*";
      if (origin) {
        res.headers.set("Access-Control-Allow-Origin", allowOrigin);
        res.headers.set("Vary", "Origin");
      }
      return applySecurityHeaders(res, pathname);
    }

    // Public API tokens (cart/payment/tokenization)
    if (pathname.startsWith("/api/public/cart/")) {
      const token = pathname.split("/").pop() || "";
      const publicClaims = token ? await verifyPublicToken(token, "cart") : null;
      if (!publicClaims) {
        const res = new NextResponse(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
        return applySecurityHeaders(res, pathname);
      }
      requestHeaders.set("x-auth-user", publicClaims.sub || "public");
      requestHeaders.set("x-auth-role", "PUBLIC");
      const res = NextResponse.next({ request: { headers: requestHeaders } });
      return applySecurityHeaders(res, pathname);
    }

    const auth = req.headers.get("authorization") || "";
    const tokenFromAuth = auth.toLowerCase().startsWith("bearer ") ? auth : "";
    const tokenFromHeader = req.headers.get("x-auth-token") || "";
    const token = normalizeBearer(tokenFromAuth || tokenFromHeader || "");

    let claims = token ? await verifyJwt(token) : null;

    if (!claims) {
      const sessionToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
      const session = sessionToken ? await verifyAdminSessionToken(sessionToken) : null;
      if (session) {
        const jwt = await signJwt({ sub: session.email, role: session.role as any, tenantId: session.tenantId || null });
        requestHeaders.set("authorization", `Bearer ${jwt}`);
        claims = await verifyJwt(jwt);
      }
    }

    if (!claims) {
      const res = new NextResponse(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
      return applySecurityHeaders(res, pathname);
    }

    const required = permissionsForPath(pathname, req.method);
    if (required && !hasPermissions(required, claims.permissions)) {
      const res = new NextResponse(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
      return applySecurityHeaders(res, pathname);
    }

    requestHeaders.set("x-auth-user", claims.sub);
    requestHeaders.set("x-auth-role", claims.role);
    if (claims.tenantId) requestHeaders.set("x-auth-tenant-id", String(claims.tenantId));

    const res = NextResponse.next({ request: { headers: requestHeaders } });
    const allowOrigin = origin || "*";
    if (origin) {
      res.headers.set("Access-Control-Allow-Origin", allowOrigin);
      res.headers.set("Vary", "Origin");
    }
    return applySecurityHeaders(res, pathname);
  }

  const existingCsrf = req.cookies.get(CSRF_COOKIE)?.value || "";
  const csrfToken = existingCsrf || crypto.randomUUID();
  requestHeaders.set("x-csrf-token", csrfToken);

  const shouldRewriteSa = pathname.startsWith("/__sa");
  const url = shouldRewriteSa
    ? new URL(req.nextUrl.origin + pathname.replace(/^\/__sa/, "/sa") + req.nextUrl.search)
    : req.nextUrl.clone();

  if (shouldRewriteSa) {
    requestHeaders.set("x-app-pathname", url.pathname);
  }

  const isDebugPath = pathname.startsWith("/debug") || pathname.startsWith("/__debug");
  const isDebugPublic = process.env.NODE_ENV !== "production";

  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = token ? await verifyAdminSessionToken(token) : null;

  const isProtectedRoute = !isPublicPath(pathname) && !(isDebugPath && isDebugPublic);

  if (isProtectedRoute && !session) {
    const loginUrl = new URL(req.nextUrl.origin + "/login");
    loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
    const res = NextResponse.redirect(loginUrl);
    return applySecurityHeaders(res, pathname);
  }

  if (session) {
    if (isSuperAdminArea(pathname) && session.role !== "SUPER_ADMIN") {
      const res = NextResponse.redirect(new URL(req.nextUrl.origin + "/"));
      return applySecurityHeaders(res, pathname);
    }

    if (isSettingsArea(pathname) && session.role === "AGENT") {
      const res = NextResponse.redirect(new URL(req.nextUrl.origin + "/"));
      return applySecurityHeaders(res, pathname);
    }

    if (isLogsArea(pathname) && session.role !== "SUPER_ADMIN") {
      const res = NextResponse.redirect(new URL(req.nextUrl.origin + "/"));
      return applySecurityHeaders(res, pathname);
    }

    requestHeaders.set("x-auth-user", session.email);
    requestHeaders.set("x-auth-role", session.role);
    if (session.tenantId) requestHeaders.set("x-auth-tenant-id", session.tenantId);
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

  return applySecurityHeaders(response, pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
