async function fetchJson(path: string) {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export default async function Home() {
  const health = await fetchJson("/health");
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
                Salud: <a href="/logs" style={{ textDecoration: "underline" }}>ver logs</a>
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Siguiente: configurar credenciales (Wompi/Chatwoot) y crear clientes/suscripciones.
            </div>
          </div>

          <div className="card cardPad" style={{ display: "grid", gap: 10 }}>
            <strong>Acciones rápidas</strong>
            <div className="toolbar">
              <a className="btn btnPrimary" href="/settings">Configurar credenciales</a>
              <a className="btn" href="/subscriptions">Nueva suscripción</a>
              <a className="btn" href="/customers">Crear cliente</a>
            </div>
          </div>
        </div>
      </div>
  );
}
