export const dynamic = "force-dynamic";

export default function ServerErrorPage() {
  return (
    <main style={{ padding: 32, display: "grid", gap: 12 }}>
      <h1 style={{ margin: 0 }}>Error del servidor</h1>
      <p style={{ margin: 0, color: "var(--muted)" }}>
        Ocurrió un error inesperado. Intenta de nuevo más tarde.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="button" href="/">
          Ir al inicio
        </a>
      </div>
    </main>
  );
}
