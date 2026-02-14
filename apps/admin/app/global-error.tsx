"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin global error boundary:", error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", padding: 32 }}>
        <main style={{ display: "grid", gap: 12 }}>
          <h1 style={{ margin: 0 }}>Error inesperado</h1>
          <p style={{ margin: 0, color: "#475569" }}>Estamos trabajando para resolverlo.</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={() => reset()} style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "#0f766e", color: "#fff", fontWeight: 600 }}>
              Reintentar
            </button>
            <a href="/" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5f5", color: "#0f172a", textDecoration: "none" }}>
              Ir al inicio
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
