"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isRedirect = String(error?.digest || "").startsWith("NEXT_REDIRECT") || String(error?.message || "").includes("NEXT_REDIRECT");

  useEffect(() => {
    if (isRedirect) {
      try {
        const nextPath = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      } catch {
        window.location.replace("/login");
      }
      return;
    }
    console.error("Global Error Boundary caught:", error);
  }, [error, isRedirect, reset]);

  if (isRedirect) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "300px",
        padding: "20px",
        textAlign: "center",
        gap: "12px"
      }}>
        <h2 style={{ margin: 0 }}>Redirigiendo…</h2>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Validando sesión.
        </p>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "400px",
      padding: "20px",
      textAlign: "center",
      gap: "16px"
    }}>
      <div style={{ fontSize: "48px" }}>⚠️</div>
      <h2 style={{ margin: 0 }}>Algo salió mal</h2>
      <p style={{ color: "var(--muted)", maxWidth: "400px", margin: "0 auto" }}>
        No pudimos cargar esta sección. Esto puede deberse a un problema temporal de conexión con el API.
      </p>
      
      <div style={{
        display: "flex",
        gap: "12px",
        marginTop: "8px"
      }}>
        <button
          className="primary"
          onClick={() => reset()}
          style={{ height: "40px" }}
        >
          Reintentar carga
        </button>
        <button
          className="ghost"
          onClick={() => window.location.href = "/"}
          style={{ height: "40px" }}
        >
          Volver al Inicio
        </button>
      </div>

      {process.env.NODE_ENV !== "production" && (
        <pre style={{
          marginTop: "24px",
          padding: "12px",
          background: "rgba(15, 23, 42, 0.05)",
          borderRadius: "8px",
          fontSize: "12px",
          textAlign: "left",
          maxWidth: "100%",
          overflow: "auto",
          color: "var(--danger)"
        }}>
          {error.message}
        </pre>
      )}
    </div>
  );
}
