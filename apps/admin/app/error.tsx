"use client";

import Link from "next/link";
import { useEffect } from "react";

export const dynamic = "force-dynamic";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to help diagnose render-time errors without surfacing raw objects in the UI.
    console.error("Admin app error boundary:", error);
  }, [error]);

  return (
    <main style={{ padding: 32, display: "grid", gap: 12 }}>
      <h1 style={{ margin: 0 }}>Algo salió mal</h1>
      <p style={{ margin: 0, color: "var(--muted)" }}>Intenta recargar o vuelve al inicio.</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="primary" onClick={() => reset()}>
          Reintentar
        </button>
        <Link className="button" href="/">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
