import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import Script from "next/script";

import "./globals.css";
import "./styles.css";
import "leaflet/dist/leaflet.css";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { GlobalLoader } from "./GlobalLoader";
import { ThemeClient } from "./ThemeClient";
import { FormValidation } from "./FormValidation";
import { RealtimeNotifier } from "./ui/RealtimeNotifier";
import { fetchAdminCached } from "./lib/adminApi";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../lib/session";

const APP_ICONS: Metadata["icons"] = {
  icon: [
    { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
    { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" }
  ],
  shortcut: [{ url: "/favicon.ico" }],
  apple: [{ url: "/apple-touch-icon.png" }]
};

async function resolveTenantName(tenantId: string | null) {
  if (!tenantId) return "";
  const tenantsRes = await fetchAdminCached("/admin/tenants", { ttlMs: 1500 });
  if (!tenantsRes.ok) return "";
  const tenants = Array.isArray(tenantsRes.json?.items) ? tenantsRes.json.items : [];
  const match = tenants.find((tenant: any) => String(tenant?.id || "") === String(tenantId));
  return String(match?.name || "").trim();
}

export async function generateMetadata(): Promise<Metadata> {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const tenantName = await resolveTenantName(session?.tenantId ?? null);
  const fallbackTenantName = String(process.env.SA_DEFAULT_TENANT_NAME || process.env.DEFAULT_TENANT_NAME || "").trim();
  const resolvedName = tenantName || fallbackTenantName;
  const title = resolvedName ? `CRM ${resolvedName}` : "CRM";

  return {
    title,
    icons: APP_ICONS
  };
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  // Middleware inyecta x-app-pathname y x-auth-user
  const pathname = h.get("x-app-pathname") || "";
  const authUser = h.get("x-auth-user");
  const isPublicRoute = pathname.startsWith("/public/");
  
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
      <body className={shouldUseAuthShell ? "authBody" : undefined}>
        <Script id="apiflujos-theme-init" strategy="beforeInteractive">{`
(() => {
  try {
    const root = document.documentElement;
    const forceSystem = ${isPublicRoute ? "true" : "false"};
    const theme = forceSystem ? "" : (localStorage.getItem("apiflujos-theme") || "");
    const contrast = forceSystem ? "" : (localStorage.getItem("apiflujos-contrast") || "");
    const vision = forceSystem ? "" : (localStorage.getItem("apiflujos-vision") || "");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const prefersContrast = window.matchMedia("(prefers-contrast: more)").matches;
    const forcedColors = window.matchMedia("(forced-colors: active)").matches;
    const resolvedTheme = theme && theme !== "auto" ? theme : prefersDark ? "dark" : "light";
    const resolvedContrast = contrast === "high" ? "high" : contrast === "normal" ? "" : prefersContrast || forcedColors ? "high" : "";
    const resolvedVision = vision && vision !== "standard" ? vision : "";
    root.dataset.theme = resolvedTheme;
    if (resolvedContrast) root.dataset.contrast = resolvedContrast; else delete root.dataset.contrast;
    if (resolvedVision) root.dataset.vision = resolvedVision; else delete root.dataset.vision;
  } catch (_) {}
})();
        `}</Script>
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
              <RealtimeNotifier
                onPaymentApproved={() => {
                  try {
                    window.dispatchEvent(new CustomEvent("apiflujos:payment-approved"));
                  } catch {}
                }}
              />
              {children}
            </div>
          </div>
        )}
        <GlobalLoader />
        <FormValidation />
        {isPublicRoute ? null : <ThemeClient />}
      </body>
    </html>
  );
}
