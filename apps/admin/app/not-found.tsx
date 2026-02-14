export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main style={{ padding: 32, display: "grid", gap: 12 }}>
      <h1 style={{ margin: 0 }}>Página no encontrada</h1>
      <p style={{ margin: 0, color: "var(--muted)" }}>
        El recurso que buscas no existe o fue movido.
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
