import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { SideNav } from "./SideNav";

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
            <header className="topbar" aria-label="Topbar">
              <div style={{ display: "grid" }}>
                <h1>Productos e inventarios</h1>
                <div className="subtitle">Visibilidad operativa en tiempo real.</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/avatar.png" alt="" style={{ width: 34, height: 34, borderRadius: 999 }} />
                <div style={{ display: "grid", lineHeight: 1.1 }}>
                  <div style={{ fontWeight: 700 }}>Sebastian</div>
                  <div className="subtitle" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Admin
                  </div>
                </div>
              </div>
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
