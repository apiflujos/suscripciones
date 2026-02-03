import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", margin: 0 }}>
        <div style={{ padding: 16, borderBottom: "1px solid #eee" }}>
          <strong>Wompi Subs – Admin</strong>
          <span style={{ marginLeft: 12, color: "#666" }}>Base</span>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </body>
    </html>
  );
}

