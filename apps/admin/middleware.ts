import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function unauthorized() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="Admin"'
    }
  });
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const shouldRewriteSa = url.pathname === "/__sa" || url.pathname.startsWith("/__sa/");
  if (shouldRewriteSa) {
    url.pathname = url.pathname.replace(/^\/__sa(?=\/|$)/, "/sa");
  }

  const user = process.env.ADMIN_BASIC_USER || "";
  const pass = process.env.ADMIN_BASIC_PASS || "";
  if (!user || !pass) return shouldRewriteSa ? NextResponse.rewrite(url) : NextResponse.next();

  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) return unauthorized();
  const b64 = auth.slice("Basic ".length);
  let decoded = "";
  try {
    decoded = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return unauthorized();
  }
  const [u, p] = decoded.split(":");
  if (u !== user || p !== pass) return unauthorized();
  return shouldRewriteSa ? NextResponse.rewrite(url) : NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
