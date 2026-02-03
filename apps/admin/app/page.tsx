async function fetchJson(path: string) {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export default async function Home() {
  const health = await fetchJson("/health");
  return (
    <main>
      <h1 style={{ marginTop: 0 }}>Panel</h1>
      <p>API: {health.ok ? "OK" : `ERROR (${health.status})`}</p>
      <p>
        Próximo: conectar vistas de suscripciones/pagos y configuración de credenciales (Wompi/Chatwoot).
      </p>
    </main>
  );
}

