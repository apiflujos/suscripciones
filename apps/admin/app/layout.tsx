import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";

export const metadata: Metadata = {
  title: "Wompi Subs – Admin",
  icons: [{ rel: "icon", url: "/favicon.png" }]
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div className="app-shell">
          <aside className="sidebar" aria-label="Sidebar">
            <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Link href="/" aria-label="Ir al home">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/logo-horizontal.png" alt="Suscripciones" style={{ height: 26, width: "auto" }} />
                </Link>
                <span className="settings-group-title">ADMIN</span>
              </div>
            </div>
            <SideNav />
          </aside>

          <div className="content" style={{ alignContent: "start" }}>
            <TopBar />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
