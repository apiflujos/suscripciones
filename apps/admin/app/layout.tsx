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
  // Middleware inyecta x-app-pathname y x-auth-user
  const pathname = h.get("x-app-pathname") || "";
  const authUser = h.get("x-auth-user");
  
  // Rutas de autenticación
  const isAuthScreen =
    !pathname ||
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/sa/login") ||
    pathname.startsWith("/__sa/login") ||
    pathname === "/404" ||
    pathname === "/500" ||
    pathname === "/_error";

  let session = null;
  if (authUser) {
    // Si el middleware ya validó, podemos confiar o re-verificar rápido.
    // Para mayor seguridad y obtener el objeto completo, re-verificamos el token de la cookie
    // ya que el header solo trae strings simples.
    const c = await cookies();
    const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
    session = await verifyAdminSessionToken(sessionToken);
  }

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
