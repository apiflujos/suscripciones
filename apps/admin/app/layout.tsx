import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { cookies } from "next/headers";

import "./globals.css";
import "./styles.css";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../lib/session";

export const metadata: Metadata = {
  title: "Wompi Subs – Admin",
  icons: [{ rel: "icon", url: "/favicon.png" }]
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const pathname =
    h.get("x-app-pathname") ||
    h.get("x-invoke-path") ||
    h.get("x-matched-path") ||
    h.get("x-nextjs-url") ||
    h.get("x-forwarded-uri") ||
    h.get("x-original-uri") ||
    h.get("x-rewrite-url") ||
    "";
  const pathHint = String(pathname || "");
  const isAuthScreen =
    !pathHint ||
    pathHint.includes("/login") ||
    pathHint.includes("/sa/login") ||
    pathHint.includes("/__sa/login") ||
    pathHint.includes("/404") ||
    pathHint.includes("/500") ||
    pathHint.includes("/_error");

  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);

  const shouldUseAuthShell = isAuthScreen || !session;

  return (
    <html lang="es">
      <head />
      <body className={shouldUseAuthShell ? "authBody" : undefined}>
        {shouldUseAuthShell ? (
          <div className="authShell">{children}</div>
        ) : (
          <div className="app-shell">
            <aside className="sidebar" aria-label="Sidebar">
              <SideNav session={session} />
            </aside>
            <div className="sidebarOverlay" aria-hidden="true" />

            <div className="content" style={{ alignContent: "start" }}>
              <TopBar session={session} />
              {children}
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
