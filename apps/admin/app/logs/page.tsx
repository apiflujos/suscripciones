export const dynamic = "force-dynamic";

function getConfig() {
  const raw = String(process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || "");
  const token = raw.replace(/^Bearer\\s+/i, "").trim().replace(/^\"|\"$/g, "").replace(/^'|'$/g, "").trim();
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token
  };
}

async function fetchAdmin(path: string) {
  const { apiBase, token } = getConfig();
  const res = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: token ? { authorization: `Bearer ${token}`, "x-admin-token": token } : {}
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function retryFailedJobs() {
  "use server";
  const { apiBase, token } = getConfig();
  if (!token) return;
  await fetch(`${apiBase}/admin/logs/jobs/retry-failed`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  }).catch(() => {});
}

function normalizeLogSource(source: any) {
  const s = String(source || "");
  if (s === "settings.shopify") return "configuracion.reenvio";
  if (s === "settings.wompi") return "configuracion.wompi";
  if (s === "settings.chatwoot") return "configuracion.comunicaciones";
  return s;
}

function normalizeLogMessage(message: any) {
  const m = String(message || "");
  if (m === "Shopify settings updated") return "Configuración de reenvío actualizada";
  if (m === "Wompi settings updated") return "Credenciales de Wompi actualizadas";
  if (m === "Chatwoot settings updated") return "Credenciales de la central de comunicaciones actualizadas";
  return m;
}

function toStatusChip(level: string) {
  const v = String(level || "").toUpperCase();
  if (v === "ERROR") return { cls: "is-error", label: "Error" };
  if (v === "WARN") return { cls: "is-warning", label: "Advertencia" };
  return { cls: "is-success", label: "Exitoso" };
}

export default async function LogsPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Logs de API</h1>
        <p>Configura `API_ADMIN_TOKEN` (o `ADMIN_API_TOKEN`).</p>
      </main>
    );
  }

  const tab = typeof searchParams?.tab === "string" ? searchParams.tab : "system";
  const q = typeof searchParams?.q === "string" ? searchParams.q : "";
  const viewId = typeof searchParams?.view === "string" ? searchParams.view : "";

  const [system, jobs, webhooks] = await Promise.all([
    fetchAdmin("/admin/logs/system?take=120"),
    fetchAdmin("/admin/logs/jobs?take=200"),
    fetchAdmin("/admin/webhook-events")
  ]);

  const sysItems = (system.json?.items ?? []) as any[];
  const jobItems = (jobs.json?.items ?? []) as any[];
  const webhookItems = (webhooks.json?.items ?? []) as any[];
  const failedJobsCount = jobItems.filter((j) => String(j.status) === "FAILED").length;

  const filtered = q
    ? sysItems.filter((l) => String(l.message || "").toLowerCase().includes(q.toLowerCase()) || String(l.source || "").toLowerCase().includes(q.toLowerCase()))
    : sysItems;

  const normalized = filtered.map((l) => ({
    ...l,
    source: normalizeLogSource(l.source),
    message: normalizeLogMessage(l.message)
  }));

  const selected = viewId ? normalized.find((l) => String(l.id) === viewId) : null;

  return (
    <main className="page">
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <h3>Logs de API</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <a
                className={`ghost ${tab === "system" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "system" })}`}
              >
                Sistema
              </a>
              <a
                className={`ghost ${tab === "webhooks" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "webhooks" })}`}
              >
                Webhooks
              </a>
            </div>
          </div>

          {tab === "system" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filter-group">
                  <div className="filter-label">ID de pedido</div>
                  <form action="/logs" method="GET" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input type="hidden" name="tab" value="system" />
                    <input className="input" name="q" defaultValue={q} placeholder="Buscar en logs..." />
                    <select className="select" aria-label="Estado">
                      <option>Todos</option>
                    </select>
                    <button className="ghost" type="submit">
                      Filtrar
                    </button>
                  </form>
                </div>
              </div>

              <div className="filtersRight">
                <form action={retryFailedJobs}>
                  <button className="primary" type="submit">
                    Reintentar fallidos
                  </button>
                </form>
                <span className={`pill ${failedJobsCount > 0 ? "pillDanger" : ""}`}>{failedJobsCount} fallos</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="settings-group-body">
          {tab === "system" ? (
            <div className="panel module" style={{ padding: 0 }}>
              <table className="table" aria-label="Tabla de logs">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Entidad</th>
                    <th>Dirección</th>
                    <th>Estado</th>
                    <th>Detalle</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {normalized.map((l) => {
                    const chip = toStatusChip(l.level);
                    return (
                      <tr key={l.id}>
                        <td>{new Date(l.createdAt).toLocaleString()}</td>
                        <td>{l.source}</td>
                        <td>—</td>
                        <td>
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td>{l.message}</td>
                        <td style={{ textAlign: "right" }}>
                          <a
                            className="ghost"
                            href={`/logs?${new URLSearchParams({ tab: "system", ...(q ? { q } : {}), view: String(l.id) })}`}
                          >
                            Ver
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                  {normalized.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ color: "var(--muted)" }}>
                        Sin logs.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel module" style={{ padding: 0 }}>
              <table className="table" aria-label="Tabla de webhooks">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Evento</th>
                    <th>Estado</th>
                    <th>Checksum</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookItems.map((e) => (
                    <tr key={e.id}>
                      <td>{e.receivedAt ? new Date(e.receivedAt).toLocaleString() : "—"}</td>
                      <td>{e.eventName || "—"}</td>
                      <td>{e.processStatus || "—"}</td>
                      <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
                        {e.checksum || "—"}
                      </td>
                    </tr>
                  ))}
                  {webhookItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ color: "var(--muted)" }}>
                        Sin eventos.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          {selected ? (
            <div className="panel" aria-label="Detalle del log">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <strong>Detalle</strong>
                <a className="btnLink" href={q ? `/logs?${new URLSearchParams({ tab: "system", q })}` : "/logs"}>
                  Cerrar
                </a>
              </div>
              <div style={{ marginTop: 8, color: "var(--muted)" }}>{selected.source}</div>
              <pre style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{JSON.stringify(selected, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
