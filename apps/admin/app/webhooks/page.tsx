export const dynamic = "force-dynamic";

function getConfig() {
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token: process.env.API_ADMIN_TOKEN || ""
  };
}

async function fetchAdmin(path: string) {
  const { apiBase, token } = getConfig();
  const res = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export default async function WebhooksPage() {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Webhooks</h1>
        <p>Configura `API_ADMIN_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const data = await fetchAdmin("/admin/webhook-events");
  const items = (data.json?.items ?? []) as any[];

  return (
    <main>
      <h1 style={{ marginTop: 0 }}>Webhooks</h1>
      <p>Últimos 50 eventos.</p>
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((e) => (
          <div key={e.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <strong>{e.eventName}</strong>
              <span style={{ color: "#666" }}>{e.processStatus}</span>
              <span style={{ color: "#666" }}>{new Date(e.receivedAt).toLocaleString()}</span>
            </div>
            <div style={{ marginTop: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
              checksum: {e.checksum}
            </div>
            {e.errorMessage ? <div style={{ marginTop: 8, color: "#b00" }}>error: {e.errorMessage}</div> : null}
          </div>
        ))}
        {items.length === 0 ? <div style={{ color: "#666" }}>Sin eventos.</div> : null}
      </div>
    </main>
  );
}
