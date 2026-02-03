const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = process.env.API_ADMIN_TOKEN || "";

async function fetchAdmin(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export default async function LogsPage() {
  if (!TOKEN) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Logs</h1>
        <p>Configura `API_ADMIN_TOKEN`.</p>
      </main>
    );
  }

  const [system, jobs, payments] = await Promise.all([
    fetchAdmin("/admin/logs/system?take=50"),
    fetchAdmin("/admin/logs/jobs?take=50"),
    fetchAdmin("/admin/logs/payments?take=20")
  ]);

  const sysItems = (system.json?.items ?? []) as any[];
  const jobItems = (jobs.json?.items ?? []) as any[];
  const payItems = (payments.json?.items ?? []) as any[];

  return (
    <main style={{ display: "grid", gap: 16 }}>
      <h1 style={{ marginTop: 0 }}>Logs</h1>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>System logs</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {sysItems.map((l) => (
            <div key={l.id} style={{ border: "1px solid #f2f2f2", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <strong>{l.level}</strong>
                <span style={{ color: "#666" }}>{l.source}</span>
                <span style={{ color: "#666" }}>{new Date(l.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ marginTop: 8 }}>{l.message}</div>
            </div>
          ))}
          {sysItems.length === 0 ? <div style={{ color: "#666" }}>Sin logs.</div> : null}
        </div>
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Retry jobs</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {jobItems.map((j) => (
            <div key={j.id} style={{ border: "1px solid #f2f2f2", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <strong>{j.type}</strong>
                <span style={{ color: "#666" }}>{j.status}</span>
                <span style={{ color: "#666" }}>attempts: {j.attempts}/{j.maxAttempts}</span>
              </div>
              {j.lastError ? <div style={{ marginTop: 8, color: "#b00" }}>{j.lastError}</div> : null}
            </div>
          ))}
          {jobItems.length === 0 ? <div style={{ color: "#666" }}>Sin jobs.</div> : null}
        </div>
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Pagos</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {payItems.map((p) => (
            <div key={p.id} style={{ border: "1px solid #f2f2f2", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <strong>{p.status}</strong>
                <span style={{ color: "#666" }}>{p.amountInCents} {p.currency}</span>
                <span style={{ color: "#666" }}>ref: {p.reference}</span>
              </div>
              {p.checkoutUrl ? (
                <div style={{ marginTop: 8 }}>
                  <a href={p.checkoutUrl} target="_blank" rel="noreferrer">Abrir checkout</a>
                </div>
              ) : null}
            </div>
          ))}
          {payItems.length === 0 ? <div style={{ color: "#666" }}>Sin pagos.</div> : null}
        </div>
      </section>
    </main>
  );
}

