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

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const pathname = h.get("x-app-pathname") || "";
  const isAuthScreen = pathname === "/login" || pathname === "/sa/login" || pathname === "/__sa/login";

  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);

  return (
    <html lang="es">
      <head />
      <body className={isAuthScreen ? "authBody" : undefined}>
        {isAuthScreen ? (
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
