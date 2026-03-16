import Link from "next/link";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { LocalDateTime } from "../ui/LocalDateTime";
import { LogsSystemTable } from "./LogsSystemTable";
import { AiAssistant } from "./AiAssistant";
import { LogsFiltersAutoSubmit } from "./LogsFiltersAutoSubmit";
import { getCsrfToken, assertCsrfToken } from "../lib/csrf";
import { PendingButton } from "../ui/PendingButton";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";
import { ReconcilePaymentModal } from "./ReconcilePaymentModal";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";

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

async function retryFailedWebhooks(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const { apiBase, token } = getConfig();
  if (!token) return;
  await fetch(`${apiBase}/admin/logs/webhooks/retry-failed`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  }).catch(() => {});
  revalidatePath("/logs");
  revalidatePath("/payments");
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
  const tenantId = String(formData.get("tenantId") || "").trim();
  const amountInCentsRaw = Number(String(formData.get("amountInCents") || "0"));
  const amountInCents = Number.isFinite(amountInCentsRaw) ? Math.trunc(amountInCentsRaw) : 0;
  const currency = String(formData.get("currency") || "").trim().toUpperCase();
  if (!wompiTransactionId && !reference && !wompiPaymentLinkId && !paymentId) return;
  await fetch(`${apiBase}/admin/logs/payments/reconcile`, {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      wompiTransactionId: wompiTransactionId || undefined,
      reference: reference || undefined,
      paymentId: paymentId || undefined,
      wompiPaymentLinkId: wompiPaymentLinkId || undefined,
      tenantId: tenantId || undefined,
      amountInCents: amountInCents > 0 ? amountInCents : undefined,
      currency: currency || undefined
    })
  }).catch(() => {});
  revalidatePath("/logs");
  revalidatePath("/payments");
}

async function reconcilePendingPayments(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const { apiBase, token } = getConfig();
  if (!token) return;
  const tenantId = String(formData.get("tenantId") || "").trim();
  const daysRaw = Number(String(formData.get("days") || "7"));
  const minutesRaw = Number(String(formData.get("minutes") || "720"));
  const takeRaw = Number(String(formData.get("take") || "100"));
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.trunc(daysRaw), 1), 30) : 7;
  const minutes = Number.isFinite(minutesRaw) ? Math.min(Math.max(Math.trunc(minutesRaw), 10), 60 * 24 * 30) : 720;
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 100;
  const recQ = new URLSearchParams({
    days: String(days),
    take: String(Math.max(200, take)),
    ...(tenantId ? { tenantId } : {})
  });
  await fetch(`${apiBase}/admin/logs/payments/recollect?${recQ.toString()}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token
    }
  }).catch(() => {});
  await fetch(`${apiBase}/admin/logs/payments/reconcile-pending`, {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify({ minutes, take, ...(tenantId ? { tenantId } : {}) })
  }).catch(() => {});
  revalidatePath("/logs");
  revalidatePath("/payments");
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

function formatElapsedLabel(value?: string | Date | null) {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = d.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const seconds = Math.max(1, Math.floor(absMs / 1000));
  const minutes = Math.floor(absMs / (60 * 1000));
  const hours = Math.floor(absMs / (60 * 60 * 1000));
  const days = Math.floor(absMs / (24 * 60 * 60 * 1000));
  const prefix = diffMs > 0 ? "en" : "hace";
  if (days >= 1) return `${prefix} ${days} d`;
  if (hours >= 1) return `${prefix} ${hours} h`;
  if (minutes >= 1) return `${prefix} ${minutes} min`;
  return `${prefix} ${seconds} s`;
}

function renderContactBlock(item: any) {
  const tx =
    item?.providerResponse?.data?.transaction ||
    item?.providerResponse?.transaction ||
    item?.providerResponse?.webhook?.data?.transaction ||
    {};
  const txCustomer = tx?.customer_data || tx?.customerData || tx?.customer || {};
  const name =
    item?.customer?.name ||
    item?.subscription?.customer?.name ||
    item?.customerName ||
    txCustomer?.full_name ||
    txCustomer?.name ||
    txCustomer?.fullName ||
    "Cliente sin nombre";
  const email =
    item?.customer?.email ||
    item?.subscription?.customer?.email ||
    item?.customerEmail ||
    tx?.customer_email ||
    tx?.customerEmail ||
    txCustomer?.email ||
    "";
  const phone =
    item?.customer?.phone ||
    item?.subscription?.customer?.phone ||
    item?.customerPhone ||
    txCustomer?.phone_number ||
    txCustomer?.phoneNumber ||
    txCustomer?.phone ||
    "";
  const fallbackId = item?.customerId ? `ID ${String(item.customerId).slice(0, 8)}` : "";
  const meta = [email, phone, fallbackId].filter(Boolean).join(" · ");
  const title = [name, email, phone].filter(Boolean).join(" · ");
  return (
    <div className="log-contact" title={title || "—"}>
      <span className="log-contact-name">{name || "Cliente sin nombre"}</span>
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

  // VERIFICAR QUE SOLO SUPER ADMIN PUEDE VER LOGS
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  if (session?.role !== "SUPER_ADMIN") {
    // Redirigir usuarios normales a settings (sus notificaciones están allí)
    redirect("/settings?tab=notificaciones");
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
  const includeIgnored = ["1", "true", "yes", "on"].includes(String(typeof sp.includeIgnored === "string" ? sp.includeIgnored : "").toLowerCase());
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
    ...(tenantId ? { tenantId } : {}),
    ...(includeIgnored ? { includeIgnored: "1" } : {})
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
      }
    }
  }
  const empty = { ok: true, status: 200, json: { items: [], total: null } } as const;
  const system = tab === "system" ? await fetchAdmin(`/admin/logs/system?${systemParams.toString()}`) : empty;
  const jobs = tab === "jobs" ? await fetchAdmin(`/admin/logs/jobs?${baseParams.toString()}`) : empty;
  const webhooks = tab === "webhooks" ? await fetchAdmin(`/admin/webhook-events?${webhooksParams.toString()}`) : empty;
  const messages = tab === "messages" ? await fetchAdmin(`/admin/logs/messages?${baseParams.toString()}`) : empty;
  const payments = tab === "payments" ? await fetchAdmin(`/admin/logs/payments?${paymentsParams.toString()}`) : empty;
  const paymentsHealth = tab === "payments" ? await fetchAdmin("/admin/logs/payments/health") : empty;
  const paymentsSettings = tab === "payments" ? await fetchAdmin("/admin/settings") : empty;
  const jobsHealth = tab === "jobs" || tab === "payments" ? await fetchAdmin("/admin/logs/jobs/health") : empty;
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
  const paymentsHealthInfo = paymentsHealth?.ok ? paymentsHealth.json : null;
  const paymentsConfig = paymentsSettings?.ok ? paymentsSettings.json?.paymentsConfig : null;

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
                      <span className="jobs-health-value">
                        {jobsHealthInfo?.lastSeenAt ? <LocalDateTime value={jobsHealthInfo.lastSeenAt} variant="short" /> : "—"}
                      </span>
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
                      <span className="jobs-health-value">
                        {jobsHealthInfo?.nextJobAt ? (
                          <>
                            {normalizeJobType(jobsHealthInfo.nextJobType)} · <LocalDateTime value={jobsHealthInfo.nextJobAt} variant="short" />
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : tab === "payments" ? (
            <div className="filtersRow">
              <div className="filtersLeft">
                <div className="filtersPanel">
                  <div className="contacts-search-row payments-search-row">
                    <form action="/payments" method="GET" className="filtersForm filtersSearch payments-search-form" data-debounce-form="true">
                      {includeIgnored ? <input type="hidden" name="includeIgnored" value="1" /> : null}
                      {status ? <input type="hidden" name="status" value={status} /> : null}
                      {from ? <input type="hidden" name="from" value={from} /> : null}
                      {to ? <input type="hidden" name="to" value={to} /> : null}
                      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                      <input
                        className="input"
                        name="q"
                        defaultValue={q}
                        placeholder="Buscar cliente, referencia o transacción..."
                        aria-label="Buscar pagos"
                      />
                      <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
                    </form>
                    <div className="module-search-right payments-module-search-right">
                      <SmartViewsBar
                        scope="payments"
                        initialViewId={viewId}
                        initialFilters={filters}
                        compactInline
                        baseParams={{
                          ...(q ? { q } : {})
                        }}
                      />
                      <div className="payments-buttons-wrap">
                        <Link
                          className="ghost btn-compact btn-noicon"
                          href={`/payments?${new URLSearchParams({
                            ...(q ? { q } : {}),
                            ...(status ? { status } : {}),
                            ...(from ? { from } : {}),
                            ...(to ? { to } : {}),
                            ...(tenantId ? { tenantId } : {}),
                            ...(includeIgnored ? {} : { includeIgnored: "1" })
                          }).toString()}`}
                        >
                          {includeIgnored ? "Ocultar externos ignorados" : "Mostrar externos ignorados"}
                        </Link>
                        <form action={reconcilePendingPayments} className="filtersForm payments-action-form">
                          <input type="hidden" name="csrf" value={csrfToken} />
                          <input type="hidden" name="days" value="7" />
                          <input type="hidden" name="minutes" value="720" />
                          <input type="hidden" name="take" value="150" />
                          {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                          <PendingButton className="ghost btn-compact btn-noicon" type="submit" pendingText="Conciliando...">
                            Recolectar pagos
                          </PendingButton>
                        </form>
                        <div className="payments-action-form" title="Reconciliación manual de una transacción Wompi">
                          <ReconcilePaymentModal csrfToken={csrfToken} action={reconcilePayment} />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="payments-totals-row">
                    <span className="pill">Total {totals.payments ?? paymentsSummary.total}</span>
                    <span className="pill pill-ok">Pagados {paymentsSummary.approved}</span>
                    <span className="pill pill-warn">Pendientes {paymentsSummary.pending}</span>
                    <span className="pill pill-bad">Fallidos {paymentsSummary.failed}</span>
                  </div>
                  {(() => {
                    const banners: Array<{ tone: "warn" | "danger" | "info"; text: React.ReactNode; action?: React.ReactNode }> = [];

                    // Configuración crítica
                    if (paymentsHealthInfo && !paymentsHealthInfo.wompiEventsSecretConfigured) {
                      banners.push({
                        tone: "danger",
                        text: "Wompi Events Secret no configurado. Los webhooks serán rechazados.",
                        action: (
                          <a className="ghost btn-compact btn-noicon" href="/settings?tab=cobros">
                            Configurar
                          </a>
                        )
                      });
                    }
                    if (paymentsHealthInfo && !paymentsHealthInfo.defaultTenantConfigured) {
                      banners.push({
                        tone: "danger",
                        text: "No hay tenant por defecto. Los pagos entrantes pueden fallar.",
                        action: (
                          <a className="ghost btn-compact btn-noicon" href="/settings?tab=cobros">
                            Configurar
                          </a>
                        )
                      });
                    }

                    // Estado del Runner
                    if (jobsHealthInfo && !jobsHealthInfo.healthy) {
                      const lastSeenLabel = jobsHealthInfo.lastSeenAt ? formatElapsedLabel(jobsHealthInfo.lastSeenAt) : null;
                      const nextJobLabel = jobsHealthInfo.nextJobAt ? formatElapsedLabel(jobsHealthInfo.nextJobAt) : null;

                      const parts: React.ReactNode[] = ["Runner inactivo."];
                      if (jobsHealthInfo.lastSeenAt) {
                        parts.push(`Última actividad: ${lastSeenLabel}`);
                      }
                      if (jobsHealthInfo.pending) parts.push(`${jobsHealthInfo.pending} pendientes`);
                      if (jobsHealthInfo.failed) parts.push(`${jobsHealthInfo.failed} fallidos`);
                      if (nextJobLabel) parts.push(`Próximo: ${nextJobLabel}`);

                      banners.push({
                        tone: "warn",
                        text: parts.join(" · "),
                        action: (
                          <a className="ghost btn-compact btn-noicon" href="/logs?tab=jobs">
                            Ver jobs
                          </a>
                        )
                      });
                    } else if (jobsHealthInfo?.healthy && (jobsHealthInfo.pending || jobsHealthInfo.nextJobAt)) {
                      const nextJobLabel = jobsHealthInfo.nextJobAt ? formatElapsedLabel(jobsHealthInfo.nextJobAt) : null;
                      const parts: React.ReactNode[] = ["Runner activo"];
                      if (jobsHealthInfo.pending) parts.push(`${jobsHealthInfo.pending} pendientes`);
                      if (nextJobLabel) parts.push(`Próximo: ${nextJobLabel}`);
                      banners.push({ tone: "info", text: parts.join(" · ") });
                    }

                    // Webhooks recientes
                    if (paymentsHealthInfo?.latestWebhookAt) {
                      const ageLabel = formatElapsedLabel(paymentsHealthInfo.latestWebhookAt);
                      const eventName = paymentsHealthInfo.latestWebhookEventName || "Evento";
                      const status = paymentsHealthInfo.latestWebhookStatus || "RECEIVED";
                      const statusLabel = status === "PROCESSED" ? "OK" : status === "FAILED" ? "Fallido" : "Pendiente";
                      const statusCls = status === "PROCESSED" ? "is-success" : status === "FAILED" ? "is-error" : "is-warning";

                      banners.push({
                        tone: "info",
                        text: (
                          <>
                            Último webhook: <strong>{eventName}</strong>{" "}
                            <span className={`pill pill-sm pill-${statusCls}`}>{statusLabel}</span>{" "}
                            <LocalDateTime value={paymentsHealthInfo.latestWebhookAt} variant="short" />
                            {ageLabel && <span className="muted"> · {ageLabel}</span>}
                          </>
                        )
                      });
                    }
                    if (paymentsHealthInfo?.latestProcessedAt) {
                      const ageLabel = formatElapsedLabel(paymentsHealthInfo.latestProcessedAt);
                      const eventName = paymentsHealthInfo.latestProcessedEventName || "Evento";
                      banners.push({
                        tone: "info",
                        text: (
                          <>
                            Último procesado: <strong>{eventName}</strong>{" "}
                            <LocalDateTime value={paymentsHealthInfo.latestProcessedAt} variant="short" />
                            {ageLabel && <span className="muted"> · {ageLabel}</span>}
                          </>
                        )
                      });
                    }

                    // Cola de webhooks
                    if (paymentsHealthInfo && paymentsHealthInfo.pendingWebhookEvents > 0) {
                      banners.push({
                        tone: "warn",
                        text: `${paymentsHealthInfo.pendingWebhookEvents} webhooks pendientes`
                      });
                    }
                    if (paymentsHealthInfo && paymentsHealthInfo.failedWebhookEvents > 0) {
                      banners.push({
                        tone: "warn",
                        text: `${paymentsHealthInfo.failedWebhookEvents} webhooks fallidos`,
                        action: (
                          <form action={retryFailedWebhooks} className="payments-health-action">
                            <input type="hidden" name="csrf" value={csrfToken} />
                            <PendingButton className="ghost btn-compact btn-noicon" type="submit" pendingText="Reintentando...">
                              Reintentar
                            </PendingButton>
                          </form>
                        )
                      });
                    }

                    // Configuración de pagos
                    if (paymentsConfig) {
                      const accept = paymentsConfig.acceptUnlinkedPayments !== false;
                      const include = paymentsConfig.includeUnlinkedPaymentsInMetrics !== false;
                      const notifyWhatsapp = paymentsConfig.notifyWhatsappForUnlinkedPayments !== false;

                      if (!accept) {
                        banners.push({
                          tone: "warn",
                          text: (
                            <>
                              <strong>Pagos externos ignorados:</strong> Se marcan como <code>IGNORED_EXTERNAL</code>.
                              Usa <code>includeIgnored=1</code> para verlos.
                            </>
                          ),
                          action: (
                            <a className="ghost btn-compact btn-noicon" href="/settings?tab=cobros">
                              Configurar
                            </a>
                          )
                        });
                      }
                      if (!include) {
                        banners.push({
                          tone: "info",
                          text: <><strong>Métricas:</strong> Pagos sin suscripción no se incluyen.</>,
                          action: (
                            <a className="ghost btn-compact btn-noicon" href="/settings?tab=cobros">
                              Configurar
                            </a>
                          )
                        });
                      }
                      if (!notifyWhatsapp && !accept) {
                        banners.push({
                          tone: "info",
                          text: <><strong>WhatsApp:</strong> No se notifican pagos no asociados.</>
                        });
                      }
                    }

                    return banners.length ? (
                      <div className="payments-health-stack">
                        {banners.map((b, idx) => (
                          <div key={`pay-banner-${idx}`} className={`payments-health-banner is-${b.tone}`}>
                            <span>{b.text}</span>
                            {b.action ?? null}
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}
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
              <div className="payments-table-wrap">
              <table className="table logs-table logs-table-payments" aria-label="Tabla de pagos">
                <colgroup>
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "190px" }} />
                  <col style={{ width: "180px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "260px" }} />
                  <col style={{ width: "220px" }} />
                  <col style={{ width: "220px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Suscripción</th>
                    <th>Estado</th>
                    <th>Total</th>
                    <th>Referencia e IDs</th>
                    <th>Detalle</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {paymentItems.map((p) => {
                    const chip = paymentStatusChip(p.status);
                    const isIgnoredExternal = Boolean(p.isIgnoredExternal);
                    const ignoredReason = String(p?.reconciliation?.reason || "").trim();
                    const referenceText = String(p.reference || "").trim();
                    const wompiTxText = String(p.wompiTransactionId || "").trim();
                    const wompiLinkText = String(p.wompiPaymentLinkId || "").trim();
                    const planName = isIgnoredExternal ? "Externo ignorado" : (p.subscription?.plan?.name || "Falta asociar suscripción");
                    const contactQuery =
                      p.customer?.email ||
                      p.customer?.phone ||
                      p.customer?.name ||
                      p.subscription?.customer?.email ||
                      p.subscription?.customer?.phone ||
                      p.subscription?.customer?.name;
                    const contactId = String(p.customer?.id || p.subscription?.customer?.id || p.customerId || "").trim();
                    const isFailed = chip.label === "Fallido";
                    const failureReason = isFailed
                      ? String(
                          p.failureReason ||
                            p.attempts?.[0]?.errorMessage ||
                            p.providerResponse?.status_message ||
                            "Sin detalle de Wompi"
                        )
                      : "—";
                    const detailText = isIgnoredExternal
                      ? `Externo ignorado${ignoredReason ? ` · ${ignoredReason}` : ""}`
                      : failureReason;
                    return (
                      <tr key={p.id}>
                        <td className="log-date-cell"><LocalDateTime value={p.paidAt || p.createdAt} variant="stacked" /></td>
                        <td className="log-contact-cell">{renderContactBlock(p)}</td>
                        <td className="log-plan-cell" title={planName}>{planName}</td>
                        <td className="log-status-cell">
                          <span className={`status-chip ${chip.cls}`}>
                            <span className={`status-led ${chip.cls === "is-success" ? "is-ok" : ""}`} />
                            {chip.label}
                          </span>
                        </td>
                        <td>{formatAmount(p.amountInCents, p.currency)}</td>
                        <td
                          className="log-ref-cell"
                          title={[referenceText || "—", wompiTxText || null, wompiLinkText || null].filter(Boolean).join(" · ")}
                        >
                          <div className="log-ref-stack">
                            <span className="log-ref-main">{referenceText || "—"}</span>
                            {wompiTxText ? <span className="log-ref-meta">Tx: {wompiTxText}</span> : null}
                            {wompiLinkText ? <span className="log-ref-meta">Link: {wompiLinkText}</span> : null}
                          </div>
                        </td>
                        <td className="log-payment-error-cell" title={detailText}>
                          {detailText}
                        </td>
                        <td className="log-payment-actions-cell">
                          <div className="log-payment-actions">
                            {!isIgnoredExternal && String(p.status || "").toUpperCase() === "PENDING" ? (
                              <form action={reconcilePayment}>
                                <input type="hidden" name="csrf" value={csrfToken} />
                                <input type="hidden" name="paymentId" value={String(p.id || "")} />
                                <input type="hidden" name="reference" value={String(p.reference || "")} />
                                <input type="hidden" name="wompiTransactionId" value={String(p.wompiTransactionId || "")} />
                                <input type="hidden" name="wompiPaymentLinkId" value={String(p.wompiPaymentLinkId || "")} />
                                <input type="hidden" name="tenantId" value={String(tenantId || p.tenantId || "")} />
                                <input type="hidden" name="amountInCents" value={String(Number(p.amountInCents || 0))} />
                                <input type="hidden" name="currency" value={String(p.currency || "COP")} />
                                <PendingButton className="ghost btn-compact btn-noicon" type="submit" pendingText="Conciliando...">
                                  Conciliar
                                </PendingButton>
                              </form>
                            ) : null}
                            {!isIgnoredExternal && !p.subscriptionId && (contactId || contactQuery) ? (
                              <Link
                                className="ghost btn-compact btn-noicon"
                                href={`/billing?${new URLSearchParams({
                                  ...(contactId ? { q: contactId } : {}),
                                  ...(!contactId && contactQuery ? { q: String(contactQuery) } : {})
                                }).toString()}`}
                              >
                                Asociar suscripción
                              </Link>
                            ) : null}
                            {contactId ? (
                              <Link className="ghost btn-compact btn-view" href={`/customers/${encodeURIComponent(contactId)}`}>
                                Ver cliente
                              </Link>
                            ) : contactQuery ? (
                              <Link className="ghost btn-compact btn-view" href={`/customers?q=${encodeURIComponent(String(contactQuery))}`}>
                                Ver cliente
                              </Link>
                            ) : null}
                          </div>
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
            </div>
          ) : (
            <div className="panel module" style={{ padding: 0 }}>
              <div className="filtersRow" style={{ padding: "12px 16px 0" }}>
                <div className="filtersLeft">
                  <div className="filtersPanel">
                    <form action="/logs" method="GET" className="filtersForm filtersSearch" data-debounce-form="true">
                      <input type="hidden" name="tab" value="webhooks" />
                      <input className="input" name="q" defaultValue={q} placeholder="Buscar cliente, referencia o tx..." aria-label="Buscar webhooks" />
                      <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
                    </form>
                  </div>
                </div>
              </div>
              <div className="webhooks-table-wrap">
                  <table className="table logs-table logs-table-webhooks" aria-label="Tabla de webhooks">
                    <colgroup>
                      <col style={{ width: "130px" }} />
                      <col style={{ width: "240px" }} />
                      <col style={{ width: "120px" }} />
                      <col style={{ width: "230px" }} />
                      <col style={{ width: "140px" }} />
                      <col style={{ width: "190px" }} />
                      <col style={{ width: "150px" }} />
                      <col style={{ width: "130px" }} />
                      <col style={{ width: "130px" }} />
                      <col style={{ width: "140px" }} />
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
                        <td className="log-actions-cell" style={{ textAlign: "right" }}>
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
            </div>
          )}

          {pagination}
        </div>
      </section>
    </main>
  );
}
