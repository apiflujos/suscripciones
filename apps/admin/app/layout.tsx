import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { cookies } from "next/headers";

import "./globals.css";
import "./styles.css";
import "leaflet/dist/leaflet.css";
import { ClientProviders } from "./ClientProviders";
import { ShellGate } from "./ShellGate";
import { listTenants } from "./admin/_services/tenants";
import type { AdminSession } from "../lib/session";
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
  const tenants = await listTenants();
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
  const forwardedUri = h.get("x-forwarded-uri") || h.get("x-original-uri") || h.get("x-rewrite-url") || "";
  const forwardedPath = forwardedUri.split("?")[0] || "";
  const pathname = h.get("x-app-pathname") || forwardedPath || "";
  const authUser = h.get("x-auth-user");
  
  // El middleware ya verificó autenticación y redirigió si era necesario
  // Aquí solo necesitamos la sesión para UI (TopBar, SideNav, permisos)
  let session: AdminSession | null = null;
  if (authUser) {
    const c = await cookies();
    const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
    session = await verifyAdminSessionToken(sessionToken);
  }

  const isPublicRoute = pathname === "/login" || pathname === "/logout" || pathname.startsWith("/public/") || pathname === "/wompi/widget" || pathname === "/404" || pathname === "/500" || pathname === "/_error";
  const forceSystemTheme = isPublicRoute ? "1" : "0";

  return (
    <html lang="es" suppressHydrationWarning data-force-system-theme={forceSystemTheme}>
      <head>
        <link id="theme-favicon" rel="icon" type="image/svg+xml" href="/brand/isotipo_icono.svg" data-theme-favicon="true" />
        <script src="/theme-init.js" />
      </head>
      <body>
        <ShellGate session={session}>{children}</ShellGate>
        <ClientProviders />
      </body>
    </html>
  );
}
