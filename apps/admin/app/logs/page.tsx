import Link from "next/link";
import { revalidatePath } from "next/cache";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { LocalDateTime } from "../ui/LocalDateTime";
import { LogsSystemTable } from "./LogsSystemTable";
import { AiAssistant } from "./AiAssistant";
import { LogsFiltersAutoSubmit } from "./LogsFiltersAutoSubmit";
import { getCsrfToken, assertCsrfToken } from "../lib/csrf";
import { PendingButton } from "../ui/PendingButton";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";
import { ReconcilePaymentModal } from "./ReconcilePaymentModal";

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

async function reconcilePayment(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const { apiBase, token } = getConfig();
  if (!token) return;
  const wompiTransactionId = String(formData.get("wompiTransactionId") || "").trim();
  const reference = String(formData.get("reference") || "").trim();
  const paymentId = String(formData.get("paymentId") || "").trim();
  const wompiPaymentLinkId = String(formData.get("wompiPaymentLinkId") || "").trim();
  if (!wompiTransactionId) return;
  await fetch(`${apiBase}/admin/logs/payments/reconcile`, {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      wompiTransactionId,
      reference: reference || undefined,
      paymentId: paymentId || undefined,
      wompiPaymentLinkId: wompiPaymentLinkId || undefined
    })
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
  if (v === "GAMIFICATION_RECALC") return "Recalcular gamificación";
  if (v === "DATA_TRAINER") return "Entrenador de datos";
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
  const title = [name, email, phone].filter(Boolean).join(" · ");
  return (
    <div className="log-contact" title={title || "—"}>
      <span className="log-contact-name">{name || "—"}</span>
      {meta ? <span className="log-contact-meta muted">{meta}</span> : null}
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
  const routeBase = tab === "payments" ? "/payments" : "/logs";
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const level = typeof sp.level === "string" ? sp.level : "";
  const processStatus = typeof sp.processStatus === "string" ? sp.processStatus : "";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
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
    ...(Number.isFinite(skip) && skip > 0 ? { skip: String(skip) } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
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

  if ((viewId || filters) && (tab === "system" || tab === "payments")) {
    const scope = tab === "payments" ? "payments" : "logs";
    let payload: any = null;
    if (viewId) payload = { viewId };
    else if (filters) {
      try {
        payload = { filters: JSON.parse(filters) };
      } catch {
        payload = null;
      }
    }
    if (payload) {
      const res = await fetch(`/api/smart-views/${scope}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      const ids = Array.isArray(json?.ids) ? json.ids : [];
      if (ids.length) {
        if (tab === "payments") paymentsParams.set("ids", ids.join(","));
        else systemParams.set("ids", ids.join(","));
      } else {
        if (tab === "payments") paymentsParams.set("ids", "__none__");
        else systemParams.set("ids", "__none__");
      }
    }
  }
  const empty = { ok: true, status: 200, json: { items: [], total: null } } as const;
  const system = tab === "system" ? await fetchAdmin(`/admin/logs/system?${systemParams.toString()}`) : empty;
  const jobs = tab === "jobs" ? await fetchAdmin(`/admin/logs/jobs?${baseParams.toString()}`) : empty;
  const jobsHealth = tab === "jobs" ? await fetchAdmin("/admin/logs/jobs/health") : empty;
  const webhooks = tab === "webhooks" ? await fetchAdmin(`/admin/webhook-events?${webhooksParams.toString()}`) : empty;
  const messages = tab === "messages" ? await fetchAdmin(`/admin/logs/messages?${baseParams.toString()}`) : empty;
  const payments = tab === "payments" ? await fetchAdmin(`/admin/logs/payments?${paymentsParams.toString()}`) : empty;
  const settingsRes = await fetchAdmin("/admin/settings");
  const aiConfig = settingsRes.ok ? settingsRes.json?.ai : null;
  const aiProviders = aiConfig?.providers || null;
  const aiEnabled = Boolean(aiConfig?.enabled && (aiProviders?.openai?.configured || aiProviders?.deepseek?.configured));

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
  const failedJobsCount = jobItems.filter((j) => String(j.status) === "FAILED").length;
  const jobSummary = jobItems.reduce(
    (acc: { ok: number; pending: number; failed: number }, j: any) => {
      const s = String(j.status || "").toUpperCase();
      if (s === "FAILED") acc.failed += 1;
      else if (s === "PENDING" || s === "RUNNING") acc.pending += 1;
      else acc.ok += 1;
      return acc;
    },
    { ok: 0, pending: 0, failed: 0 }
  );
  const messageSummary = messageItems.reduce(
    (acc: { sent: number; pending: number; failed: number }, m: any) => {
      const s = String(m.status || "").toUpperCase();
      if (s === "SENT") acc.sent += 1;
      else if (s === "FAILED") acc.failed += 1;
      else acc.pending += 1;
      return acc;
    },
    { sent: 0, pending: 0, failed: 0 }
  );
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

  const jobsHealthInfo = jobsHealth?.ok ? jobsHealth.json : null;
  const jobsHeartbeatLabel =
    jobsHealthInfo?.lastSeenAt ? <LocalDateTime value={jobsHealthInfo.lastSeenAt} variant="short" /> : "—";
  const jobsNextLabel =
    jobsHealthInfo?.nextJobAt ? (
      <>
        {normalizeJobType(jobsHealthInfo?.nextJobType)} · <LocalDateTime value={jobsHealthInfo.nextJobAt} variant="short" />
      </>
    ) : (
      "—"
    );

  const filtered = q
    ? sysItems.filter((l) => String(l.message || "").toLowerCase().includes(q.toLowerCase()) || String(l.source || "").toLowerCase().includes(q.toLowerCase()))
    : sysItems;

  const normalized = filtered.map((l) => ({
    ...l,
    source: normalizeLogSource(l.source),
    message: normalizeLogMessage(l.message)
  }));
  const paginationInfo = (() => {
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
    const totalPages = totalCount != null ? Math.max(1, Math.ceil(totalCount / take)) : currentPage + (hasNext ? 1 : 0);
    const desktopWindow = 10;
    let start = Math.max(1, currentPage - Math.floor(desktopWindow / 2));
    let end = start + (desktopWindow - 1);
    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - (desktopWindow - 1));
    }
    const pages = [];
    for (let i = start; i <= end; i += 1) pages.push(i);
    const mobileWindow = 5;
    let mobileStart = Math.max(1, currentPage - 2);
    let mobileEnd = mobileStart + (mobileWindow - 1);
    if (mobileEnd > totalPages) {
      mobileEnd = totalPages;
      mobileStart = Math.max(1, mobileEnd - (mobileWindow - 1));
    }
    const baseParams = {
      tab,
      ...(q ? { q } : {}),
      ...(tab === "system" && level ? { level } : {}),
      ...(tab === "payments" && status ? { status } : {}),
      ...(tab === "webhooks" && processStatus ? { processStatus } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(viewId ? { viewId } : {}),
      ...(filters ? { filters } : {})
    };
    const startIndex = countOnPage ? (currentPage - 1) * take + 1 : 0;
    const endIndex = countOnPage ? (currentPage - 1) * take + countOnPage : 0;
    const totalLabel = totalCount != null ? ` de ${totalCount}` : "";
    const summaryText = `Mostrando ${countOnPage ? `${startIndex}-${endIndex}${totalLabel}` : "0"} · ${take} por página`;
    const showSummary = tab !== "system" && tab !== "webhooks";
    return {
      summaryText,
      component: (
      <div className="pagination pagination-indicator">
        {showSummary ? <div className="pagination-summary">{summaryText}</div> : null}
        <a
          className="page-link page-nav"
          href={`${routeBase}?${new URLSearchParams({
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
                href={`${routeBase}?${new URLSearchParams({ ...baseParams, page: String(p) })}`}
                aria-current={p === currentPage ? "page" : undefined}
              >
                {p}
              </a>
            );
          })}
        </div>
        <a
          className="page-link page-nav"
          href={`${routeBase}?${new URLSearchParams({
            ...baseParams,
            page: String(currentPage + 1)
          })}`}
          aria-disabled={!hasNext}
        >
          Siguiente
        </a>
      </div>
      )
    };
  })();
  const pagination = paginationInfo.component;
  const paginationSummary = paginationInfo.summaryText;
  const systemSummary = normalized.reduce(
    (acc: { info: number; warn: number; error: number }, l: any) => {
      const lvl = String(l.level || "").toUpperCase();
      if (lvl === "ERROR") acc.error += 1;
      else if (lvl === "WARN") acc.warn += 1;
      else acc.info += 1;
      return acc;
    },
    { info: 0, warn: 0, error: 0 }
  );

  return (
    <main className="page">
      <LogsFiltersAutoSubmit />
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            {tab !== "payments" ? (
              <div className="panel-tabs">
                <Link
                  className={`ghost no-icon panel-tab ${tab === "system" ? "is-active" : ""}`}
                  href={`/logs?${new URLSearchParams({ tab: "system" })}`}
                  prefetch={false}
                  data-loader={tab === "system" ? "off" : undefined}
                  aria-disabled={tab === "system" ? "true" : undefined}
                  tabIndex={tab === "system" ? -1 : undefined}
                >
                  Sistema
                </Link>
                <Link
                  className={`ghost no-icon panel-tab ${tab === "webhooks" ? "is-active" : ""}`}
                  href={`/logs?${new URLSearchParams({ tab: "webhooks" })}`}
                  prefetch={false}
                  data-loader={tab === "webhooks" ? "off" : undefined}
                  aria-disabled={tab === "webhooks" ? "true" : undefined}
                  tabIndex={tab === "webhooks" ? -1 : undefined}
                >
                  Webhooks
                </Link>
                <Link
                  className={`ghost no-icon panel-tab ${tab === "messages" ? "is-active" : ""}`}
                  href={`/logs?${new URLSearchParams({ tab: "messages" })}`}
                  prefetch={false}
                  data-loader={tab === "messages" ? "off" : undefined}
                  aria-disabled={tab === "messages" ? "true" : undefined}
                  tabIndex={tab === "messages" ? -1 : undefined}
                >
                  Mensajes
                </Link>
                <Link
                  className={`ghost no-icon panel-tab ${tab === "jobs" ? "is-active" : ""}`}
                  href={`/logs?${new URLSearchParams({ tab: "jobs" })}`}
                  prefetch={false}
                  data-loader={tab === "jobs" ? "off" : undefined}
                  aria-disabled={tab === "jobs" ? "true" : undefined}
                  tabIndex={tab === "jobs" ? -1 : undefined}
                >
                  Jobs
                </Link>
              </div>
            ) : null}
            <div className="panelHeaderPills">
              {tab === "system" ? (
                <>
                  <span className="pill">Total {totals.system ?? normalized.length}</span>
                  <span className="pill pill-ok">Info {systemSummary.info}</span>
                  <span className="pill pill-warn">Alertas {systemSummary.warn}</span>
                  <span className="pill pill-bad">Errores {systemSummary.error}</span>
                </>
              ) : null}
              {tab === "webhooks" ? (
                <>
                  <span className="pill">Total {totals.webhooks ?? webhooksSummary.total}</span>
                  <span className="pill pill-ok">Procesados {webhooksSummary.processed}</span>
                  <span className="pill pill-warn">Recibidos {webhooksSummary.skipped}</span>
                  <span className="pill pill-bad">Fallidos {webhooksSummary.failed}</span>
                </>
              ) : null}
              {tab === "payments" ? (
                <>
                  <span className="pill">Total {totals.payments ?? paymentsSummary.total}</span>
                  <span className="pill pill-ok">Pagados {paymentsSummary.approved}</span>
                  <span className="pill pill-warn">Pendientes {paymentsSummary.pending}</span>
                  <span className="pill pill-bad">Fallidos {paymentsSummary.failed}</span>
                </>
              ) : null}
              {tab === "messages" ? (
                <>
                  <span className="pill">Total {totals.messages ?? messageItems.length}</span>
                  <span className="pill pill-ok">Enviados {messageSummary.sent}</span>
                  <span className="pill pill-warn">Pendientes {messageSummary.pending}</span>
                  <span className="pill pill-bad">Fallidos {messageSummary.failed}</span>
                </>
              ) : null}
              {tab === "jobs" ? (
                <>
                  <span className="pill">Total {totals.jobs ?? jobItems.length}</span>
                  <span className="pill pill-ok">Procesados {jobSummary.ok}</span>
                  <span className="pill pill-warn">Pendientes {jobSummary.pending}</span>
                  <span className="pill pill-bad">Fallidos {jobSummary.failed}</span>
                </>
              ) : null}
            </div>
          </div>

          {tab === "system" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filtersTop">
                  <div className="filtersNote">
                    Busca por evento o fuente (por defecto últimos 30 días). <span className="muted">Vistas = filtros guardados.</span>
                  </div>
                  <div className="filtersSummary">{paginationSummary}</div>
                </div>
                <div className="filtersPanel">
                  <SmartViewsBar
                    scope="logs"
                    initialViewId={viewId}
                    initialFilters={filters}
                    baseParams={{
                      tab: "system",
                      ...(q ? { q } : {}),
                      ...(level ? { level } : {}),
                      ...(from ? { from } : {}),
                      ...(to ? { to } : {})
                    }}
                  />
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
              <div className="filtersRight">
                <div className={`jobs-health-card ${jobsHealthInfo?.healthy ? "is-ok" : "is-warn"}`}>
                  <div className="jobs-health-header">
                    <span className="jobs-health-dot" aria-hidden="true" />
                    <span>Runner</span>
                    <span className="jobs-health-badge">{jobsHealthInfo?.healthy ? "Activo" : "Sin latido"}</span>
                  </div>
                  <div className="jobs-health-grid">
                    <div>
                      <span className="jobs-health-label">Último ping</span>
                      <span className="jobs-health-value">{jobsHeartbeatLabel}</span>
                    </div>
                    <div>
                      <span className="jobs-health-label">Pendientes</span>
                      <span className="jobs-health-value">{jobsHealthInfo?.pending ?? "—"}</span>
                    </div>
                    <div>
                      <span className="jobs-health-label">Corriendo</span>
                      <span className="jobs-health-value">{jobsHealthInfo?.running ?? "—"}</span>
                    </div>
                    <div>
                      <span className="jobs-health-label">Fallidos</span>
                      <span className="jobs-health-value">{jobsHealthInfo?.failed ?? "—"}</span>
                    </div>
                    <div className="jobs-health-wide">
                      <span className="jobs-health-label">Próximo job</span>
                      <span className="jobs-health-value">{jobsNextLabel}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : tab === "payments" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filtersNote">Consulta pagos por cliente, referencia o estado (por defecto últimos 30 días).</div>
                <div className="filtersPanel">
                  <div className="contacts-search-row">
                    <form action="/payments" method="GET" className="filtersForm filtersSearch" data-debounce-form="true">
                      <input
                        className="input"
                        name="q"
                        defaultValue={q}
                        placeholder="Buscar cliente, referencia o transacción..."
                        aria-label="Buscar pagos"
                      />
                      <select className="select" name="status" defaultValue={status} data-auto-submit="true">
                        <option value="">Estado: todos</option>
                        <option value="APPROVED">Pagado</option>
                        <option value="PENDING">Pendiente</option>
                        <option value="DECLINED">Declinado</option>
                        <option value="ERROR">Error</option>
                        <option value="VOIDED">Anulado</option>
                      </select>
                      <input className="input" type="date" name="from" defaultValue={from} aria-label="Desde" data-auto-submit="true" />
                      <input className="input" type="date" name="to" defaultValue={to} aria-label="Hasta" data-auto-submit="true" />
                      <button className="ghost" type="submit">Buscar</button>
                    </form>
                    <SmartViewsBar
                      scope="payments"
                      initialViewId={viewId}
                      initialFilters={filters}
                      compactInline
                      baseParams={{
                        ...(q ? { q } : {}),
                        ...(status ? { status } : {}),
                        ...(from ? { from } : {}),
                        ...(to ? { to } : {})
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="filtersRight">
                <div className="panel" style={{ padding: 12, minWidth: 240 }}>
                  <div className="filter-group" style={{ marginBottom: 8 }}>
                    <div className="filter-label">Reconciliación Wompi</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>Abre el modal para ejecutar la reconciliación manual.</div>
                  </div>
                  <ReconcilePaymentModal csrfToken={csrfToken} action={reconcilePayment} />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="settings-group-body">
          {aiEnabled ? (
            <div className="logs-ai-wrapper">
              <AiAssistant from={from} to={to} tenantId={tenantId || undefined} scope="logs" />
            </div>
          ) : null}
          {pagination}
          {tab === "system" ? (
            <LogsSystemTable items={normalized} />
          ) : tab === "messages" ? (
            <div className="panel module" style={{ padding: 0 }}>
              <table className="table logs-table logs-table-messages" aria-label="Tabla de mensajes">
                <colgroup>
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "52%" }} />
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
                        <td className="log-date-cell"><LocalDateTime value={m.createdAt} variant="stacked" /></td>
                        <td className="log-contact-cell">{renderContactBlock(m)}</td>
                        <td className="log-type-cell" title={m.type || "—"}>{m.type || "—"}</td>
                        <td className="log-status-cell">
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
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "6%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "30%" }} />
                  <col style={{ width: "10%" }} />
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
                    const detailRaw = String(j.lastError || webhookNote || "—");
                    const detail = detailRaw.length > 260 ? `${detailRaw.slice(0, 260)}…` : detailRaw;
                    const scheduleAt =
                      status === "PENDING"
                        ? j.runAt
                        : status === "RUNNING"
                          ? j.lockedAt
                          : status === "FAILED"
                            ? j.updatedAt
                            : null;
                    const scheduleLabel =
                      status === "PENDING"
                        ? "Programado"
                        : status === "RUNNING"
                          ? "En ejecución"
                          : status === "FAILED"
                            ? "Falló"
                            : "Actualizado";
                    return (
                      <tr key={j.id}>
                        <td className="log-date-cell"><LocalDateTime value={j.updatedAt} variant="stacked" /></td>
                        <td title={normalizeJobType(j.type)}>{normalizeJobType(j.type)}</td>
                        <td className="log-status-cell">
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td>{attemptsShown} / {maxAttempts}</td>
                        <td className="log-target-cell" title={target}>{target}</td>
                        <td className="log-detail-cell" title={detailRaw}>
                          <span className="log-message-text">{detail}</span>
                          {scheduleAt ? (
                            <span className="log-detail-meta muted">
                              {scheduleLabel}: <LocalDateTime value={scheduleAt} variant="short" />
                            </span>
                          ) : null}
                          {j.lockedBy ? (
                            <span className="log-detail-meta muted">Worker: {j.lockedBy}</span>
                          ) : null}
                        </td>
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
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "17%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "8%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Plan</th>
                    <th>Estado</th>
                    <th>Monto</th>
                    <th>Referencia</th>
                    <th>ID pago Wompi</th>
                    <th>ID link Wompi</th>
                    <th>Motivo fallo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {paymentItems.map((p) => {
                    const chip = paymentStatusChip(p.status);
                    const planName = p.subscription?.plan?.name || "—";
                    const contactQuery = p.customer?.email || p.customer?.phone || p.customer?.name;
                    const isFailed = chip.label === "Fallido";
                    const failureReason = isFailed
                      ? String(
                          p.failureReason ||
                            p.attempts?.[0]?.errorMessage ||
                            p.providerResponse?.status_message ||
                            "Sin detalle de Wompi"
                        )
                      : "—";
                    return (
                      <tr key={p.id}>
                        <td className="log-date-cell"><LocalDateTime value={p.createdAt} variant="stacked" /></td>
                        <td className="log-contact-cell">{renderContactBlock(p)}</td>
                        <td className="log-plan-cell" title={planName}>{planName}</td>
                        <td className="log-status-cell">
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td>{formatAmount(p.amountInCents, p.currency)}</td>
                        <td className="log-ref-cell" title={p.reference || "—"}>
                          <span className="log-ref-main">{p.reference || "—"}</span>
                        </td>
                        <td className="log-transaction-cell" title={p.wompiTransactionId || "—"}>
                          {p.wompiTransactionId || "—"}
                        </td>
                        <td className="log-transaction-cell" title={p.wompiPaymentLinkId || "—"}>
                          {p.wompiPaymentLinkId || "—"}
                        </td>
                        <td className="log-payment-error-cell" title={failureReason}>
                          {failureReason}
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
                  {paymentItems.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ color: "var(--muted)" }}>
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
                  <div className="filtersTop">
                    <div className="filtersNote">Webhooks con trazabilidad de cliente y pago (por defecto últimos 30 días).</div>
                    <div className="filtersSummary">{paginationSummary}</div>
                  </div>
                  <div className="filtersPanel">
                    <form action="/logs" method="GET" className="filtersForm" data-debounce-form="true">
                      <input type="hidden" name="tab" value="webhooks" />
                      <input className="input" name="q" defaultValue={q} placeholder="Buscar cliente, referencia o tx..." aria-label="Buscar webhooks" />
                      <select className="select" name="processStatus" defaultValue={processStatus} data-auto-submit="true">
                        <option value="">Procesamiento: todos</option>
                        <option value="PROCESSED">Procesado</option>
                        <option value="FAILED">Fallido</option>
                        <option value="SKIPPED">Omitido</option>
                      </select>
                      <input className="input" type="date" name="from" defaultValue={from} aria-label="Desde" data-auto-submit="true" />
                      <input className="input" type="date" name="to" defaultValue={to} aria-label="Hasta" data-auto-submit="true" />
                      <button className="ghost" type="submit">Filtrar</button>
                    </form>
                  </div>
                </div>
              </div>
                  <table className="table logs-table logs-table-webhooks" aria-label="Tabla de webhooks">
                    <colgroup>
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "17%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "7%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "6%" }} />
                      <col style={{ width: "12%" }} />
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
                    const errorMessage = String(e.errorMessage || "").trim();
                    const hasFailure = String(e.processStatus || "").toUpperCase() === "FAILED" || Boolean(errorMessage);
                    const errorFilter = (e.reference || e.wompiTransactionId || e.wompiPaymentLinkId || errorMessage || "").toString().trim();
                    const errorParams = new URLSearchParams({
                      tab: "webhooks",
                      processStatus: "FAILED",
                      ...(errorFilter ? { q: errorFilter } : {}),
                      ...(from ? { from } : {}),
                      ...(to ? { to } : {}),
                      ...(tenantId ? { tenantId } : {})
                    });
                    return (
                      <tr key={e.id}>
                        <td className="log-date-cell"><LocalDateTime value={e.receivedAt} variant="stacked" /></td>
                        <td className="log-contact-cell">{renderContactBlock(e)}</td>
                        <td>{formatAmount(e.amountInCents, e.currency)}</td>
                        <td className="log-ref-cell" title={[e.reference, refMeta].filter(Boolean).join(" · ") || "—"}>
                          <div className="log-ref">
                            <span className="log-ref-main">{e.reference || "—"}</span>
                            {refMeta ? <span className="log-ref-meta">{refMeta}</span> : null}
                          </div>
                        </td>
                        <td className="log-type-cell" title={e.paymentType || e.eventName || "—"}>{e.paymentType || e.eventName || "—"}</td>
                        <td className="log-plan-cell" title={e.planName || "—"}>{e.planName || "—"}</td>
                        <td className="log-status-cell">
                          <span className={`status-chip ${processChip.cls}`}>
                            <span className={`status-led ${processChip.cls === "is-success" ? "is-ok" : ""}`} />
                            {processChip.label}
                          </span>
                        </td>
                        <td className="log-status-cell">
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td className="log-error-cell">
                          {hasFailure ? (
                            <Link className="ghost btn-compact btn-xs btn-fail" href={`/logs?${errorParams.toString()}`}>
                              Ver fallo
                            </Link>
                          ) : (
                            "—"
                          )}
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
