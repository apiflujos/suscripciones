import Link from "next/link";
import { revalidatePath } from "next/cache";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { LocalDateTime } from "../ui/LocalDateTime";
import { LogsSystemTable } from "./LogsSystemTable";
import { AiAssistant } from "./AiAssistant";
import { getCsrfToken, assertCsrfToken } from "../lib/csrf";
import { PendingButton } from "../ui/PendingButton";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchAdmin(path: string) {
  return fetchAdminCached(path, { ttlMs: 1500 });
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

async function retryWebhook(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const { apiBase, token } = getConfig();
  if (!token) return;
  const id = String(formData.get("id") || "").trim();
  if (!id) return;
  await fetch(`${apiBase}/admin/logs/webhooks/${encodeURIComponent(id)}/retry`, {
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
  if (v === "AI_ASSIST") return "Asistente IA";
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

function processStatusChip(raw: any) {
  const status = String(raw || "").toUpperCase();
  if (status === "PROCESSED") return { cls: "is-success", label: "Procesado" };
  if (status === "FAILED") return { cls: "is-error", label: "Fallido" };
  if (status === "SKIPPED") return { cls: "is-warning", label: "Omitido" };
  if (status === "RECEIVED") return { cls: "is-warning", label: "Recibido" };
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
  const status = typeof sp.status === "string" ? sp.status : "";
  const level = typeof sp.level === "string" ? sp.level : "";
  const processStatus = typeof sp.processStatus === "string" ? sp.processStatus : "";
  const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const defaultTo = new Date().toISOString().slice(0, 10);
  const from = typeof sp.from === "string" && sp.from.trim() ? sp.from : defaultFrom;
  const to = typeof sp.to === "string" && sp.to.trim() ? sp.to : defaultTo;
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  const baseParams = new URLSearchParams({
    take: String(take),
    count: "1",
    ...(Number.isFinite(skip) && skip > 0 ? { skip: String(skip) } : {})
  });
  const systemParams = new URLSearchParams({
    take: String(take),
    count: "1",
    ...(Number.isFinite(skip) && skip > 0 ? { skip: String(skip) } : {}),
    ...(q ? { q } : {}),
    ...(level ? { level } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  });
  const paymentsParams = new URLSearchParams({
    take: String(take),
    count: "1",
    ...(Number.isFinite(skip) && skip > 0 ? { skip: String(skip) } : {}),
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(tenantId ? { tenantId } : {})
  });
  const webhooksParams = new URLSearchParams({
    take: String(take),
    count: "1",
    ...(Number.isFinite(skip) && skip > 0 ? { skip: String(skip) } : {}),
    ...(q ? { q } : {}),
    ...(processStatus ? { processStatus } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(tenantId ? { tenantId } : {})
  });
  const [system, jobs, webhooks, messages, payments] = await Promise.all([
    fetchAdmin(`/admin/logs/system?${systemParams.toString()}`),
    fetchAdmin(`/admin/logs/jobs?${baseParams.toString()}`),
    fetchAdmin(`/admin/webhook-events?${webhooksParams.toString()}`),
    fetchAdmin(`/admin/logs/messages?${baseParams.toString()}`),
    fetchAdmin(`/admin/logs/payments?${paymentsParams.toString()}`)
  ]);

  const sysItems = (system.json?.items ?? []) as any[];
  const jobItems = (jobs.json?.items ?? []) as any[];
  const webhookItems = (webhooks.json?.items ?? []) as any[];
  const messageItems = (messages.json?.items ?? []) as any[];
  const paymentItems = (payments.json?.items ?? []) as any[];
  const totals = {
    system: typeof system.json?.total === "number" ? system.json.total : null,
    jobs: typeof jobs.json?.total === "number" ? jobs.json.total : null,
    webhooks: typeof webhooks.json?.total === "number" ? webhooks.json.total : null,
    messages: typeof messages.json?.total === "number" ? messages.json.total : null,
    payments: typeof payments.json?.total === "number" ? payments.json.total : null
  };
  const pagination = (() => {
    const currentPage = Math.max(1, Number(page) || 1);
    const countOnPage =
      tab === "system"
        ? normalized.length
        : tab === "messages"
          ? messageItems.length
          : tab === "jobs"
            ? jobItems.length
            : tab === "payments"
              ? paymentItems.length
              : webhookItems.length;
    const totalCount =
      tab === "system"
        ? totals.system
        : tab === "messages"
          ? totals.messages
          : tab === "jobs"
            ? totals.jobs
            : tab === "payments"
              ? totals.payments
              : totals.webhooks;
    const hasNext = totalCount != null ? (currentPage - 1) * take + countOnPage < totalCount : countOnPage >= take;
    const maxForward = hasNext ? 1 : 0;
    const desktopWindow = 10;
    const end = currentPage + maxForward;
    const start = Math.max(1, end - (desktopWindow - 1));
    const pages = [];
    for (let i = start; i <= end; i += 1) pages.push(i);
    const mobileWindow = 5;
    const mobileStart = Math.max(start, Math.min(currentPage - 2, end - (mobileWindow - 1)));
    const mobileEnd = Math.min(end, mobileStart + (mobileWindow - 1));
    const baseParams = {
      tab,
      ...(q ? { q } : {}),
      ...(tab === "system" && level ? { level } : {}),
      ...(tab === "payments" && status ? { status } : {}),
      ...(tab === "webhooks" && processStatus ? { processStatus } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(tenantId ? { tenantId } : {})
    };
    const startIndex = countOnPage ? (currentPage - 1) * take + 1 : 0;
    const endIndex = countOnPage ? (currentPage - 1) * take + countOnPage : 0;
    const totalLabel = totalCount != null ? ` de ${totalCount}` : "";
    return (
      <div className="pagination pagination-indicator">
        <div className="pagination-summary">
          Mostrando {countOnPage ? `${startIndex}-${endIndex}${totalLabel}` : "0"} · {take} por página
        </div>
        <a
          className="page-link page-nav"
          href={`/logs?${new URLSearchParams({
            ...baseParams,
            page: String(Math.max(1, currentPage - 1))
          })}`}
          aria-disabled={currentPage <= 1}
        >
          Anterior
        </a>
        <div className="pagination-pages">
          {pages.map((p) => {
            const isDesktopOnly = p < mobileStart || p > mobileEnd;
            return (
              <a
                key={`logs-page-${p}`}
                className={`page-link ${p === currentPage ? "is-active" : ""} ${isDesktopOnly ? "page-desktop-only" : ""}`}
                href={`/logs?${new URLSearchParams({ ...baseParams, page: String(p) })}`}
                aria-current={p === currentPage ? "page" : undefined}
              >
                {p}
              </a>
            );
          })}
        </div>
        <a
          className="page-link page-nav"
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
  })();
  const failedJobsCount = jobItems.filter((j) => String(j.status) === "FAILED").length;
  const paymentsSummary = paymentItems.reduce(
    (acc: { approved: number; pending: number; failed: number; total: number }, p: any) => {
      const s = String(p.status || "").toUpperCase();
      if (s === "APPROVED") acc.approved += 1;
      else if (s === "PENDING" || s === "PROCESSING") acc.pending += 1;
      else acc.failed += 1;
      acc.total += 1;
      return acc;
    },
    { approved: 0, pending: 0, failed: 0, total: 0 }
  );
  const webhooksSummary = webhookItems.reduce(
    (acc: { processed: number; failed: number; skipped: number; total: number }, e: any) => {
      const s = String(e.processStatus || "").toUpperCase();
      if (s === "PROCESSED") acc.processed += 1;
      else if (s === "FAILED") acc.failed += 1;
      else if (s === "SKIPPED") acc.skipped += 1;
      acc.total += 1;
      return acc;
    },
    { processed: 0, failed: 0, skipped: 0, total: 0 }
  );

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
                data-loader={tab === "system" ? "off" : undefined}
                aria-disabled={tab === "system" ? "true" : undefined}
                tabIndex={tab === "system" ? -1 : undefined}
              >
                Sistema
              </Link>
              <Link
                className={`ghost no-icon panel-tab ${tab === "webhooks" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "webhooks" })}`}
                data-loader={tab === "webhooks" ? "off" : undefined}
                aria-disabled={tab === "webhooks" ? "true" : undefined}
                tabIndex={tab === "webhooks" ? -1 : undefined}
              >
                Webhooks
              </Link>
              <Link
                className={`ghost no-icon panel-tab ${tab === "messages" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "messages" })}`}
                data-loader={tab === "messages" ? "off" : undefined}
                aria-disabled={tab === "messages" ? "true" : undefined}
                tabIndex={tab === "messages" ? -1 : undefined}
              >
                Mensajes
              </Link>
              <Link
                className={`ghost no-icon panel-tab ${tab === "jobs" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "jobs" })}`}
                data-loader={tab === "jobs" ? "off" : undefined}
                aria-disabled={tab === "jobs" ? "true" : undefined}
                tabIndex={tab === "jobs" ? -1 : undefined}
              >
                Jobs
              </Link>
              <Link
                className={`ghost no-icon panel-tab ${tab === "payments" ? "is-active" : ""}`}
                href={`/logs?${new URLSearchParams({ tab: "payments" })}`}
                data-loader={tab === "payments" ? "off" : undefined}
                aria-disabled={tab === "payments" ? "true" : undefined}
                tabIndex={tab === "payments" ? -1 : undefined}
              >
                Pagos
              </Link>
            </div>
            <div className="panelHeaderPills">
              {tab === "webhooks" ? (
                <>
                  <span className="pill pill-ok">Procesados {webhooksSummary.processed}</span>
                  <span className="pill pill-warn">Omitidos {webhooksSummary.skipped}</span>
                  <span className="pill pill-bad">Fallidos {webhooksSummary.failed}</span>
                </>
              ) : null}
              {tab === "payments" ? (
                <>
                  <span className="pill pill-ok">Pagados {paymentsSummary.approved}</span>
                  <span className="pill pill-warn">Pendientes {paymentsSummary.pending}</span>
                  <span className="pill pill-bad">Fallidos {paymentsSummary.failed}</span>
                </>
              ) : null}
              {tab === "jobs" || tab === "system" ? (
                <span className={`pill ${failedJobsCount > 0 ? "pillDanger" : ""}`}>{failedJobsCount} fallos</span>
              ) : null}
            </div>
          </div>

          {tab === "system" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filtersNote">Busca por evento o fuente (por defecto últimos 30 días).</div>
                <div className="filtersPanel">
                  <form action="/logs" method="GET" className="filtersForm">
                    <input type="hidden" name="tab" value="system" />
                    <input className="input" name="q" defaultValue={q} placeholder="Buscar en logs..." aria-label="Buscar en logs" />
                    <select className="select" name="level" defaultValue={level}>
                      <option value="">Estado: todos</option>
                      <option value="INFO">Exitoso</option>
                      <option value="WARN">Advertencia</option>
                      <option value="ERROR">Error</option>
                    </select>
                    <input className="input" type="date" name="from" defaultValue={from} aria-label="Desde" />
                    <input className="input" type="date" name="to" defaultValue={to} aria-label="Hasta" />
                    <button className="ghost" type="submit">
                      Filtrar
                    </button>
                  </form>
                </div>
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
            </div>
          ) : tab === "payments" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filtersNote">Consulta pagos por cliente, referencia o estado (por defecto últimos 30 días).</div>
                <div className="filtersPanel">
                  <form action="/logs" method="GET" className="filtersForm">
                    <input type="hidden" name="tab" value="payments" />
                    <input className="input" name="q" defaultValue={q} placeholder="Buscar cliente, referencia, tx o link..." aria-label="Buscar pagos" />
                    <select className="select" name="status" defaultValue={status}>
                      <option value="">Estado: todos</option>
                      <option value="APPROVED">Pagado</option>
                      <option value="PENDING">Pendiente</option>
                      <option value="FAILED">Fallido</option>
                    </select>
                    <input className="input" type="date" name="from" defaultValue={from} aria-label="Desde" />
                    <input className="input" type="date" name="to" defaultValue={to} aria-label="Hasta" />
                    <button className="ghost" type="submit">Filtrar</button>
                  </form>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="settings-group-body">
          <div className="logs-ai-wrapper">
            <AiAssistant from={from} to={to} tenantId={tenantId} />
          </div>
          {pagination}
          {tab === "system" ? (
            <LogsSystemTable items={normalized} />
          ) : tab === "messages" ? (
            <div className="panel module" style={{ padding: 0 }}>
              <table className="table logs-table logs-table-messages" aria-label="Tabla de mensajes">
                <colgroup>
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "200px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "140px" }} />
                  <col />
                </colgroup>
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
                    const detailRaw = String(m.errorMessage || m.content || "—");
                    const detailText = detailRaw.length > 300 ? `${detailRaw.slice(0, 300)}…` : detailRaw;
                    return (
                      <tr key={m.id}>
                        <td className="log-date-cell"><LocalDateTime value={m.createdAt} variant="short" /></td>
                        <td>{m.customer?.name || m.customer?.email || "—"}</td>
                        <td>{m.type || "—"}</td>
                        <td>
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td className="log-message-cell" title={detailRaw}>
                          <span className="log-message-text">{detailText}</span>
                        </td>
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
              <table className="table logs-table logs-table-jobs" aria-label="Tabla de jobs">
                <colgroup>
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "90px" }} />
                  <col style={{ width: "240px" }} />
                  <col />
                  <col style={{ width: "130px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Estado</th>
                    <th>Intentos</th>
                    <th>Objetivo</th>
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
                    const target = j.targetLabel || j.payload?.subscriptionId || j.payload?.paymentId || j.payload?.customerId || j.payload?.webhookEventId || "—";
                    const webhookNote =
                      j.webhookProcessStatus === "FAILED"
                        ? `Webhook fallido: ${j.webhookErrorMessage || "sin detalle"}`
                        : j.webhookProcessStatus === "PROCESSED"
                          ? "Webhook procesado"
                          : null;
                    const detail = j.lastError || webhookNote || "—";
                    return (
                      <tr key={j.id}>
                        <td className="log-date-cell"><LocalDateTime value={j.updatedAt} variant="short" /></td>
                        <td>{normalizeJobType(j.type)}</td>
                        <td>
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td>{attemptsShown} / {maxAttempts}</td>
                        <td className="log-target-cell">{target}</td>
                        <td className="log-detail-cell">{detail}</td>
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
                      <td colSpan={7} style={{ color: "var(--muted)" }}>
                        Sin jobs.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : tab === "payments" ? (
            <div className="panel module" style={{ padding: 0 }}>
              <table className="table logs-table logs-table-payments" aria-label="Tabla de pagos">
                <colgroup>
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "220px" }} />
                  <col style={{ width: "200px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "220px" }} />
                  <col style={{ width: "170px" }} />
                  <col style={{ width: "130px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Plan</th>
                    <th>Estado</th>
                    <th>Monto</th>
                    <th>Referencia</th>
                    <th>Transacción</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {paymentItems.map((p) => {
                    const chip = paymentStatusChip(p.status);
                    const planName = p.subscription?.plan?.name || "—";
                    const contactQuery = p.customer?.email || p.customer?.phone || p.customer?.name;
                    return (
                      <tr key={p.id}>
                        <td className="log-date-cell"><LocalDateTime value={p.createdAt} variant="short" /></td>
                        <td>{renderContactBlock(p)}</td>
                        <td>{planName}</td>
                        <td>
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td>{formatAmount(p.amountInCents, p.currency)}</td>
                        <td className="log-ref-cell">
                          <span className="log-ref-main">{p.reference || "—"}</span>
                        </td>
                        <td className="log-transaction-cell">{p.wompiTransactionId || p.wompiPaymentLinkId || "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          {contactQuery ? (
                            <Link className="ghost btn-compact btn-view" href={`/customers?q=${encodeURIComponent(String(contactQuery))}`}>
                              Ver cliente
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {paymentItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ color: "var(--muted)" }}>
                        Sin pagos.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel module" style={{ padding: 0 }}>
              <div className="filtersRow" style={{ padding: "12px 16px 0" }}>
                <div className="filtersLeft">
                  <div className="filtersNote">Webhooks con trazabilidad de cliente y pago (por defecto últimos 30 días).</div>
                  <div className="filtersPanel">
                    <form action="/logs" method="GET" className="filtersForm">
                      <input type="hidden" name="tab" value="webhooks" />
                      <input className="input" name="q" defaultValue={q} placeholder="Buscar cliente, referencia o tx..." aria-label="Buscar webhooks" />
                      <select className="select" name="processStatus" defaultValue={processStatus}>
                        <option value="">Procesamiento: todos</option>
                        <option value="PROCESSED">Procesado</option>
                        <option value="FAILED">Fallido</option>
                        <option value="SKIPPED">Omitido</option>
                      </select>
                      <input className="input" type="date" name="from" defaultValue={from} aria-label="Desde" />
                      <input className="input" type="date" name="to" defaultValue={to} aria-label="Hasta" />
                      <button className="ghost" type="submit">Filtrar</button>
                    </form>
                  </div>
                </div>
              </div>
              <table className="table logs-table logs-table-webhooks" aria-label="Tabla de webhooks">
                <colgroup>
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "220px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "220px" }} />
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "190px" }} />
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "200px" }} />
                  <col style={{ width: "130px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Monto</th>
                    <th>Referencia</th>
                    <th>Tipo</th>
                    <th>Plan</th>
                    <th>Procesamiento</th>
                    <th>Pago</th>
                    <th>Fallo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {webhookItems.map((e) => {
                    const chip = paymentStatusChip(e.paymentStatus);
                    const processChip = processStatusChip(e.processStatus);
                    const contactQuery = e.customerEmail || e.customerPhone || e.customerName;
                    const refMeta = [e.wompiTransactionId ? `Tx ${e.wompiTransactionId}` : null, e.wompiPaymentLinkId ? `Link ${e.wompiPaymentLinkId}` : null]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr key={e.id}>
                        <td className="log-date-cell"><LocalDateTime value={e.receivedAt} variant="short" /></td>
                        <td>{renderContactBlock(e)}</td>
                        <td>{formatAmount(e.amountInCents, e.currency)}</td>
                        <td className="log-ref-cell">
                          <div className="log-ref">
                            <span className="log-ref-main">{e.reference || "—"}</span>
                            {refMeta ? <span className="log-ref-meta">{refMeta}</span> : null}
                          </div>
                        </td>
                        <td>{e.paymentType || e.eventName || "—"}</td>
                        <td>{e.planName || "—"}</td>
                        <td>
                          <span className={`status-chip ${processChip.cls}`}>
                            <span className={`status-led ${processChip.cls === "is-success" ? "is-ok" : ""}`} />
                            {processChip.label}
                          </span>
                        </td>
                        <td>
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td className="log-error-cell">
                          {String(e.errorMessage || "—").length > 120
                            ? `${String(e.errorMessage).slice(0, 120)}…`
                            : e.errorMessage || "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {contactQuery ? (
                            <Link className="ghost btn-compact btn-view" href={`/customers?q=${encodeURIComponent(String(contactQuery))}`}>
                              Ver cliente
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {webhookItems.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ color: "var(--muted)" }}>
                        Sin eventos.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          {pagination}
        </div>
      </section>
    </main>
  );
}
