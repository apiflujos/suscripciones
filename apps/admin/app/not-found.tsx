import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ padding: 32, display: "grid", gap: 12 }}>
      <h1 style={{ margin: 0 }}>Página no encontrada</h1>
      <p style={{ margin: 0, color: "var(--muted)" }}>
        El recurso que buscas no existe o fue movido.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link className="button" href="/">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
