import Link from "next/link";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { LocalDateTime } from "../ui/LocalDateTime";
import { getCsrfToken, assertCsrfToken } from "../lib/csrf";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchAdmin(path: string) {
  return fetchAdminCached(path, { ttlMs: 1500 });
}

async function retryFailedJobs(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
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
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Logs de API</h1>
        <p>Configura `ADMIN_API_TOKEN`.</p>
      </main>
    );
  }

  const sp = (await searchParams) ?? {};
  const tab = typeof sp.tab === "string" ? sp.tab : "system";
  const q = typeof sp.q === "string" ? sp.q : "";
  const viewId = typeof sp.view === "string" ? sp.view : "";

  const [system, jobs, webhooks, messages, selectedRes] = await Promise.all([
    fetchAdmin("/admin/logs/system?take=120"),
    fetchAdmin("/admin/logs/jobs?take=200"),
    fetchAdmin("/admin/webhook-events"),
    fetchAdmin("/admin/logs/messages?take=120"),
    viewId
      ? fetchAdmin(`/admin/logs/system/${encodeURIComponent(viewId)}`)
      : Promise.resolve({ ok: false, status: 0, json: null } as any)
  ]);

  const sysItems = (system.json?.items ?? []) as any[];
  const jobItems = (jobs.json?.items ?? []) as any[];
  const webhookItems = (webhooks.json?.items ?? []) as any[];
  const messageItems = (messages.json?.items ?? []) as any[];
  const failedJobsCount = jobItems.filter((j) => String(j.status) === "FAILED").length;

  const filtered = q
    ? sysItems.filter((l) => String(l.message || "").toLowerCase().includes(q.toLowerCase()) || String(l.source || "").toLowerCase().includes(q.toLowerCase()))
    : sysItems;

  const normalized = filtered.map((l) => ({
    ...l,
    source: normalizeLogSource(l.source),
    message: normalizeLogMessage(l.message)
  }));

  const selected = selectedRes?.ok ? (selectedRes.json?.item ?? null) : viewId ? normalized.find((l) => String(l.id) === viewId) : null;

  return (
    <main className="page">
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <h3>Logs de API</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Link
                className={`ghost ${tab === "system" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "system" })}`}
              >
                Sistema
              </Link>
              <Link
                className={`ghost ${tab === "webhooks" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "webhooks" })}`}
              >
                Webhooks
              </Link>
              <Link
                className={`ghost ${tab === "messages" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "messages" })}`}
              >
                Mensajes
              </Link>
            </div>
          </div>

          {tab === "system" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filter-group">
                  <div className="filter-label">ID de pedido</div>
                  <form action="/logs" method="GET" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input type="hidden" name="tab" value="system" />
                    <input className="input" name="q" defaultValue={q} placeholder="Buscar en logs..." aria-label="Buscar en logs" />
                    <select className="select" name="status" aria-label="Estado">
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
                  <input type="hidden" name="csrf" value={csrfToken} />
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
                        <td><LocalDateTime value={l.createdAt} /></td>
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
                          <Link
                            className="ghost"
                            href={`/logs?${new URLSearchParams({ tab: "system", ...(q ? { q } : {}), view: String(l.id) })}`}
                          >
                            Ver
                          </Link>
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
          ) : tab === "messages" ? (
            <div className="panel module" style={{ padding: 0 }}>
              <table className="table" aria-label="Tabla de mensajes">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Contacto</th>
                    <th>Tipo</th>
                    <th>Estado</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {messageItems.map((m) => {
                    const status = String(m.status || "");
                    const chip =
                      status === "SENT"
                        ? { cls: "is-success", label: "Enviado" }
                        : status === "FAILED"
                          ? { cls: "is-error", label: "Fallido" }
                          : { cls: "is-warning", label: "Pendiente" };
                    return (
                      <tr key={m.id}>
                        <td><LocalDateTime value={m.createdAt} /></td>
                        <td>{m.customer?.name || m.customer?.email || "—"}</td>
                        <td>{m.type || "—"}</td>
                        <td>
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td>{m.errorMessage || m.content || "—"}</td>
                      </tr>
                    );
                  })}
                  {messageItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: "var(--muted)" }}>
                        Sin mensajes.
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
                    <th>Tipo</th>
                    <th>Plan</th>
                    <th>Estado</th>
                    <th>Checksum</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookItems.map((e) => (
                    <tr key={e.id}>
                      <td><LocalDateTime value={e.receivedAt} /></td>
                      <td>{e.eventName || "—"}</td>
                      <td>{e.paymentType || "—"}</td>
                      <td>{e.planName || "—"}</td>
                      <td>{e.processStatus || "—"}</td>
                      <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
                        {e.checksum || "—"}
                      </td>
                    </tr>
                  ))}
                  {webhookItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ color: "var(--muted)" }}>
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
                <Link className="btnLink" href={q ? `/logs?${new URLSearchParams({ tab: "system", q })}` : "/logs"} prefetch={false}>
                  Cerrar
                </Link>
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
