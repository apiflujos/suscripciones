import Link from "next/link";
import { fetchPublicCached } from "./lib/adminApi";

export default async function Home() {
  const health = await fetchPublicCached("/health", { ttlMs: 3000 });
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h1 className="pageTitle">Métricas</h1>
        <p className="pageSub">Visibilidad operativa en tiempo real.</p>
      </div>

        <div className="grid2">
          <div className="card cardPad" style={{ display: "grid", gap: 10 }}>
            <strong>Estado API</strong>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`pill ${health.ok ? "" : "pillDanger"}`}>{health.ok ? "OK" : `ERROR (${health.status})`}</span>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                Salud:{" "}
                <Link href="/logs" prefetch={false} style={{ textDecoration: "underline" }}>
                  ver logs
                </Link>
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Siguiente: configurar credenciales (Wompi / central de comunicaciones) y crear contactos y cobros.
            </div>
          </div>

          <div className="card cardPad" style={{ display: "grid", gap: 10 }}>
            <strong>Acciones rápidas</strong>
            <div className="toolbar">
              <Link className="btn btnPrimary" href="/settings" prefetch={false}>
                Configurar credenciales
              </Link>
              <Link className="btn" href="/billing" prefetch={false}>
                Planes / Suscripciones
              </Link>
              <Link className="btn" href="/customers" prefetch={false}>
                Contactos
              </Link>
              <Link className="btn" href="/products" prefetch={false}>
                Productos y servicios
              </Link>
            </div>
          </div>
        </div>
      </div>
  );
}
