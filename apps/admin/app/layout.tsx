import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";

import "./globals.css";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";

export const metadata: Metadata = {
  title: "Wompi Subs – Admin",
  icons: [{ rel: "icon", url: "/favicon.png" }]
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const pathname = headers().get("x-app-pathname") || "";
  const isAuthScreen = pathname === "/sa/login" || pathname === "/__sa/login";

  return (
    <html lang="es">
      <head>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body className={isAuthScreen ? "authBody" : undefined}>
        {isAuthScreen ? (
          <div className="authShell">{children}</div>
        ) : (
          <div className="app-shell">
            <aside className="sidebar" aria-label="Sidebar">
              <SideNav />
            </aside>
            <div className="sidebarOverlay" aria-hidden="true" />

            <div className="content" style={{ alignContent: "start" }}>
              <TopBar />
              {children}
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
