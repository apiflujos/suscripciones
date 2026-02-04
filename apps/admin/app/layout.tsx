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
      <body>
        <div className="shell">
          <aside className="sidebar" aria-label="Sidebar">
            <div className="brandBlock">
              <div className="brandRow">
                <Link href="/" aria-label="Ir al home">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="logo" src="/brand/logo-horizontal.png" alt="Suscripciones" />
                </Link>
                <span className="tag">Admin</span>
              </div>
            </div>
            <SideNav />
          </aside>

          <div className="content">
            <header className="topbar">
              <div className="topbarInner">
                <div style={{ fontWeight: 700 }}>ApiFlujos</div>
                <div className="spacer" />
                <div className="userChip" aria-label="Usuario">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="avatar" src="/brand/avatar.png" alt="" />
                  <div className="userMeta">
                    <div className="userName">Sebastian</div>
                    <div className="userRole">Admin</div>
                  </div>
                </div>
              </div>
            </header>
            <main className="main">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
