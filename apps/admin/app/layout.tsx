import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Wompi Subs – Admin",
  icons: [{ rel: "icon", url: "/favicon.png" }]
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="shell">
          <header className="header">
            <div className="headerInner">
              <Link href="/" className="brand" aria-label="Ir al home">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="logo" src="/brand/logo-horizontal.png" alt="Suscripciones" />
                <span className="tag">Admin</span>
              </Link>
              <nav className="nav" aria-label="Navegación">
                <Link href="/">Home</Link>
                <Link href="/plans">Planes</Link>
                <Link href="/customers">Clientes</Link>
                <Link href="/subscriptions">Suscripciones</Link>
                <Link href="/webhooks">Webhooks</Link>
                <Link href="/logs">Logs</Link>
                <Link href="/settings">Credenciales</Link>
              </nav>
              <div className="spacer" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="avatar" src="/brand/avatar.png" alt="" />
            </div>
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
