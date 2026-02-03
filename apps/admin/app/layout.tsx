import type { ReactNode } from "react";
import Link from "next/link";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", margin: 0 }}>
        <div style={{ padding: 16, borderBottom: "1px solid #eee" }}>
          <strong>Wompi Subs – Admin</strong>
          <span style={{ marginLeft: 12, color: "#666" }}>Base</span>
          <nav style={{ marginTop: 8, display: "flex", gap: 12 }}>
            <Link href="/">Home</Link>
            <Link href="/plans">Planes</Link>
            <Link href="/customers">Clientes</Link>
            <Link href="/subscriptions">Suscripciones</Link>
            <Link href="/webhooks">Webhooks</Link>
            <Link href="/logs">Logs</Link>
            <Link href="/settings">Credenciales</Link>
          </nav>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </body>
    </html>
  );
}
