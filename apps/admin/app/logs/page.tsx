import Link from "next/link";
import { revalidatePath } from "next/cache";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { LocalDateTime } from "../ui/LocalDateTime";
import { LogsSystemTable } from "./LogsSystemTable";
import { getCsrfToken, assertCsrfToken } from "../lib/csrf";
import { PendingButton } from "../ui/PendingButton";

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
  revalidatePath("/logs");
}

async function retryShopifyForwards(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const { apiBase, token } = getConfig();
  if (!token) return;
  await fetch(`${apiBase}/admin/logs/jobs/retry-forward`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  }).catch(() => {});
  revalidatePath("/logs");
}

async function retryJob(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const { apiBase, token } = getConfig();
  if (!token) return;
  const id = String(formData.get("id") || "").trim();
  if (!id) return;
  await fetch(`${apiBase}/admin/logs/jobs/${encodeURIComponent(id)}/retry`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  }).catch(() => {});
  revalidatePath("/logs");
}

async function recollectPayments(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const { apiBase, token } = getConfig();
  if (!token) return;
  await fetch(`${apiBase}/admin/logs/payments/recollect`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  }).catch(() => {});
  revalidatePath("/logs");
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
  if (m === "Chatwoot settings updated") return "Credenciales de CentralCom actualizadas";
  return m;
}

function normalizeJobType(type: any) {
  const v = String(type || "");
  if (v === "SUBSCRIPTION_REMINDER") return "Notificación programada";
  if (v === "SEND_CHATWOOT_MESSAGE") return "Mensaje CentralCom";
  if (v === "FORWARD_WOMPI_TO_SHOPIFY") return "Forward a Shopify";
  if (v === "PROCESS_WOMPI_EVENT") return "Procesar evento Wompi";
  if (v === "PAYMENT_RETRY") return "Reintento de pago";
  if (v === "BILLING_MONTHLY_REPORT") return "Reporte mensual";
  if (v === "SEND_CAMPAIGN") return "Enviar campaña";
  if (v === "SYNC_SMART_LISTS") return "Sincronizar listas";
  return v || "—";
}

function formatAmount(amountInCents?: number | null, currency?: string | null) {
  if (typeof amountInCents !== "number") return "—";
  const value = Math.round(amountInCents);
  const formatted = new Intl.NumberFormat("es-CO").format(Math.max(0, Math.round(value / 100)));
  return `${formatted} ${currency || "COP"}`;
}

function renderContactBlock(item: any) {
  const name = item?.customer?.name || item?.customerName || "—";
  const email = item?.customer?.email || item?.customerEmail || "";
  const phone = item?.customer?.phone || item?.customerPhone || "";
  const meta = [email, phone].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span>{name || "—"}</span>
      {meta ? <span className="muted" style={{ fontSize: 12 }}>{meta}</span> : null}
    </div>
  );
}

function paymentStatusChip(raw: any) {
  const status = String(raw || "").toUpperCase();
  if (status === "APPROVED" || status === "PAID") return { cls: "is-success", label: "Pagado" };
  if (status === "PENDING" || status === "PROCESSING") return { cls: "is-warning", label: "Pendiente" };
  if (status === "DECLINED" || status === "ERROR" || status === "VOIDED" || status === "FAILED") return { cls: "is-error", label: "Fallido" };
  return { cls: "is-warning", label: status || "—" };
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
      <main className="page">
        <p>Configura `ADMIN_API_TOKEN`.</p>
      </main>
    );
  }

  const sp = (await searchParams) ?? {};
  const tab = typeof sp.tab === "string" ? sp.tab : "system";
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  const baseParams = new URLSearchParams({
    take: String(take),
    ...(Number.isFinite(skip) && skip > 0 ? { skip: String(skip) } : {})
  });
  const systemParams = new URLSearchParams({
    take: String(take),
    ...(Number.isFinite(skip) && skip > 0 ? { skip: String(skip) } : {}),
    ...(q ? { q } : {})
  });
  const [system, jobs, webhooks, messages, payments] = await Promise.all([
    fetchAdmin(`/admin/logs/system?${systemParams.toString()}`),
    fetchAdmin(`/admin/logs/jobs?${baseParams.toString()}`),
    fetchAdmin(`/admin/webhook-events?${baseParams.toString()}`),
    fetchAdmin(`/admin/logs/messages?${baseParams.toString()}`),
    fetchAdmin(`/admin/logs/payments?${baseParams.toString()}`)
  ]);

  const sysItems = (system.json?.items ?? []) as any[];
  const jobItems = (jobs.json?.items ?? []) as any[];
  const webhookItems = (webhooks.json?.items ?? []) as any[];
  const messageItems = (messages.json?.items ?? []) as any[];
  const paymentItems = (payments.json?.items ?? []) as any[];
  const failedJobsCount = jobItems.filter((j) => String(j.status) === "FAILED").length;

  const filtered = q
    ? sysItems.filter((l) => String(l.message || "").toLowerCase().includes(q.toLowerCase()) || String(l.source || "").toLowerCase().includes(q.toLowerCase()))
    : sysItems;

  const normalized = filtered.map((l) => ({
    ...l,
    source: normalizeLogSource(l.source),
    message: normalizeLogMessage(l.message)
  }));

  return (
    <main className="page">
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div className="panel-tabs">
              <Link
                className={`ghost no-icon panel-tab ${tab === "system" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "system" })}`}
              >
                Sistema
              </Link>
              <Link
                className={`ghost no-icon panel-tab ${tab === "webhooks" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "webhooks" })}`}
              >
                Webhooks
              </Link>
              <Link
                className={`ghost no-icon panel-tab ${tab === "messages" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "messages" })}`}
              >
                Mensajes
              </Link>
              <Link
                className={`ghost no-icon panel-tab ${tab === "jobs" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "jobs" })}`}
              >
                Jobs
              </Link>
              <Link
                className={`ghost no-icon panel-tab ${tab === "payments" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "payments" })}`}
              >
                Pagos
              </Link>
            </div>
          </div>

          {tab === "system" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filter-group">
                  <div className="filter-label">Búsqueda</div>
                  <form action="/logs" method="GET" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input type="hidden" name="tab" value="system" />
                    <input className="input" name="q" defaultValue={q} placeholder="Buscar en logs..." aria-label="Buscar en logs" />
                    <button className="ghost" type="submit">
                      Filtrar
                    </button>
                  </form>
                </div>
              </div>

              <div className="filtersRight">
                <form action={retryFailedJobs}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <PendingButton className="primary btn-retry" type="submit" pendingText="Reintentando...">
                    Reintentar fallidos
                  </PendingButton>
                </form>
                <form action={retryShopifyForwards}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <PendingButton className="ghost btn-retry" type="submit" pendingText="Reintentando...">
                    Reintentar forwards
                  </PendingButton>
                </form>
                <span className={`pill ${failedJobsCount > 0 ? "pillDanger" : ""}`}>{failedJobsCount} fallos</span>
              </div>
            </div>
          ) : tab === "jobs" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filter-group">
                  <div className="filter-label">Jobs</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>Reintentos uno a uno o masivos.</div>
                </div>
              </div>
              <div className="filtersRight">
                <form action={retryFailedJobs}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <PendingButton className="primary btn-retry" type="submit" pendingText="Reintentando...">
                    Reintentar fallidos
                  </PendingButton>
                </form>
                <form action={retryShopifyForwards}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <PendingButton className="ghost btn-retry" type="submit" pendingText="Reintentando...">
                    Reintentar forwards
                  </PendingButton>
                </form>
                <span className={`pill ${failedJobsCount > 0 ? "pillDanger" : ""}`}>{failedJobsCount} fallos</span>
              </div>
            </div>
          ) : tab === "payments" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filter-group">
                  <div className="filter-label">Pagos</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>Recolecta pagos faltantes desde Wompi.</div>
                </div>
              </div>
              <div className="filtersRight">
                <form action={recollectPayments}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <PendingButton className="primary btn-retry" type="submit" pendingText="Recolectando...">
                    Recolectar pagos faltantes
                  </PendingButton>
                </form>
              </div>
            </div>
          ) : null}
        </div>

        <div className="settings-group-body">
          {tab === "system" ? (
            <LogsSystemTable items={normalized} />
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
          ) : tab === "jobs" ? (
            <div className="panel module" style={{ padding: 0 }}>
              <table className="table" aria-label="Tabla de jobs">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Estado</th>
                    <th>Intentos</th>
                    <th>Detalle</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {jobItems.map((j) => {
                    const status = String(j.status || "");
                    const chip =
                      status === "FAILED"
                        ? { cls: "is-error", label: "Fallido" }
                        : status === "PENDING"
                          ? { cls: "is-warning", label: "Pendiente" }
                          : { cls: "is-success", label: "Procesado" };
                    const attemptsRaw = Number(j.attempts ?? 0);
                    const maxAttempts = Number(j.maxAttempts ?? 0);
                    const attemptsShown = status === "SUCCEEDED" && attemptsRaw === 0 ? 1 : attemptsRaw;
                    return (
                      <tr key={j.id}>
                        <td><LocalDateTime value={j.updatedAt} /></td>
                        <td>{normalizeJobType(j.type)}</td>
                        <td>
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td>{attemptsShown} / {maxAttempts}</td>
                        <td>{j.lastError || "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          {status === "FAILED" ? (
                            <form action={retryJob}>
                              <input type="hidden" name="csrf" value={csrfToken} />
                              <input type="hidden" name="id" value={j.id} />
                              <PendingButton className="ghost btn-retry" type="submit" pendingText="Reintentando...">
                                Reintentar
                              </PendingButton>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {jobItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ color: "var(--muted)" }}>
                        Sin jobs.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : tab === "payments" ? (
            <div className="panel module" style={{ padding: 0 }}>
              <table className="table" aria-label="Tabla de pagos">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Plan</th>
                    <th>Estado</th>
                    <th>Monto</th>
                    <th>Referencia</th>
                    <th>Transacción</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentItems.map((p) => {
                    const chip = paymentStatusChip(p.status);
                    const planName = p.subscription?.plan?.name || "—";
                    return (
                      <tr key={p.id}>
                        <td><LocalDateTime value={p.createdAt} /></td>
                        <td>{renderContactBlock(p)}</td>
                        <td>{planName}</td>
                        <td>
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td>{formatAmount(p.amountInCents, p.currency)}</td>
                        <td>{p.reference || "—"}</td>
                        <td>{p.wompiTransactionId || p.wompiPaymentLinkId || "—"}</td>
                      </tr>
                    );
                  })}
                  {paymentItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: "var(--muted)" }}>
                        Sin pagos.
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
                    <th>Cliente</th>
                    <th>Monto</th>
                    <th>Referencia</th>
                    <th>Tipo</th>
                    <th>Plan</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookItems.map((e) => {
                    const chip = paymentStatusChip(e.paymentStatus);
                    return (
                      <tr key={e.id}>
                        <td><LocalDateTime value={e.receivedAt} /></td>
                        <td>{renderContactBlock(e)}</td>
                        <td>{formatAmount(e.amountInCents, e.currency)}</td>
                        <td>{e.reference || "—"}</td>
                        <td>{e.paymentType || e.eventName || "—"}</td>
                        <td>{e.planName || "—"}</td>
                        <td>
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {webhookItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: "var(--muted)" }}>
                        Sin eventos.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          {(() => {
            const currentPage = Math.max(1, Number(page) || 1);
            const count = tab === "system" ? normalized.length : tab === "messages" ? messageItems.length : tab === "jobs" ? jobItems.length : tab === "payments" ? paymentItems.length : webhookItems.length;
            const hasNext = count >= take;
            const start = Math.max(1, currentPage - 2);
            const end = hasNext ? currentPage + 2 : currentPage;
            const pages = [];
            for (let i = start; i <= end; i += 1) pages.push(i);
            const baseParams = {
              tab,
              ...(tab === "system" && q ? { q } : {})
            };
            return (
              <div className="pagination">
                <a
                  className="ghost no-icon page-link page-nav"
                  href={`/logs?${new URLSearchParams({
                    ...baseParams,
                    page: String(Math.max(1, currentPage - 1))
                  })}`}
                  aria-disabled={currentPage <= 1}
                >
                  Anterior
                </a>
                <div className="pagination-pages">
                  {pages.map((p) => (
                    <a
                      key={`logs-page-${p}`}
                      className={`ghost no-icon page-link ${p === currentPage ? "is-active" : ""}`}
                      href={`/logs?${new URLSearchParams({ ...baseParams, page: String(p) })}`}
                      aria-current={p === currentPage ? "page" : undefined}
                    >
                      {p}
                    </a>
                  ))}
                </div>
                <a
                  className="ghost no-icon page-link page-nav"
                  href={`/logs?${new URLSearchParams({
                    ...baseParams,
                    page: String(currentPage + 1)
                  })}`}
                  aria-disabled={!hasNext}
                >
                  Siguiente
                </a>
              </div>
            );
          })()}
        </div>
      </section>
    </main>
  );
}
