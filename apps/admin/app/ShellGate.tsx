"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { ThemeClient } from "./ThemeClient";
import { RealtimeNotifier } from "./ui/RealtimeNotifier";
import type { AdminSession } from "../lib/session";

function isPublicRoutePath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname.startsWith("/public/") ||
    pathname === "/wompi/widget" ||
    pathname === "/404" ||
    pathname === "/500" ||
    pathname === "/_error"
  );
}

export function ShellGate({
  session,
  children
}: {
  session: AdminSession | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const isPublicRoute = isPublicRoutePath(pathname);
  const shouldShowShell = !isPublicRoute && !!session;

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("authBody", isPublicRoute);
    document.documentElement.dataset.forceSystemTheme = isPublicRoute ? "1" : "0";
  }, [isPublicRoute]);

  if (isPublicRoute) {
    return <div className="authShell">{children}</div>;
  }

  if (shouldShowShell) {
    return (
      <div className="app-shell">
        <aside className="sidebar" aria-label="Sidebar">
          <SideNav session={session} />
        </aside>
        <div className="sidebarOverlay" aria-hidden="true" />

        <div className="content" style={{ alignContent: "start" }}>
          <TopBar session={session} />
          <RealtimeNotifier session={session ? { email: session.email } : null} />
          {children}
        </div>
        <ThemeClient />
      </div>
    );
  }

  return (
    <div className="authShell">
      <div className="authCard loginCard">
        <div className="authCardInner loginCardInner">
          <div className="authHeader loginHeaderText">
            <h1 className="authTitle">Sesión expirada</h1>
            <div className="authSubtitle">Por favor, inicia sesión nuevamente.</div>
          </div>
          <div className="authAlert">Redirigiendo al login...</div>
        </div>
      </div>
    </div>
  );
}
