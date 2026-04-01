import Link from "next/link";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listChatwootMessages, listPaymentLogs, listSystemLogs, listWebhookEvents, getPaymentsHealth } from "../admin/_services/logs";
import { LocalDateTime } from "../ui/LocalDateTime";
import { LogsSystemTable } from "./LogsSystemTable";
import { AiAssistant } from "./AiAssistant";
import { LogsFiltersAutoSubmit } from "./LogsFiltersAutoSubmit";
import { getCsrfToken, assertCsrfToken } from "../lib/csrf";
import { PendingButton } from "../ui/PendingButton";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";
import { ReconcilePaymentModal } from "./ReconcilePaymentModal";
import { PageToolbar } from "../ui/PageToolbar";
import { ListCsvActions } from "../ui/ListCsvActions";
import { FilterButton } from "../ui/FilterButton";
import { ViewModeToggles } from "../ui/ViewModeToggles";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { getAdminSettings } from "../admin/_services/settings";
import { resolveSmartViewIds, parseFiltersParam, getSmartViewFields } from "@suscripciones/core/services/smartViews";
import {
  recollectPayments,
  autoAssociateUnlinkedPayments,
  associatePaymentToSubscription,
  reconcilePayment as reconcilePaymentAction,
  reconcilePendingPayments as reconcilePendingPaymentsAction,
  enqueueShopifyForwardForPayment,
  retryFailedWebhooks as retryFailedWebhooksAction,
  retryWebhookById
} from "../admin/_services/logsActions";
import { classifyReference } from "@suscripciones/core/webhooks/wompi/classifyReference";

export const dynamic = "force-dynamic";

async function getSuperAdminSession() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  if (!session || session.role !== "SUPER_ADMIN") return null;
  return session;
}

async function retryWebhook(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const session = await getSuperAdminSession();
  if (!session) return;
  const id = String(formData.get("id") || "").trim();
  if (!id) return;
  await retryWebhookById(id);
  revalidatePath("/logs");
}

async function retryFailedWebhooks(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  if (!(await getSuperAdminSession())) return;
  await retryFailedWebhooksAction();
  revalidatePath("/logs");
  revalidatePath("/payments");
}

async function reconcilePayment(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const session = await getSuperAdminSession();
  if (!session) return;
  const wompiTransactionId = String(formData.get("wompiTransactionId") || "").trim();
  const reference = String(formData.get("reference") || "").trim();
  const paymentId = String(formData.get("paymentId") || "").trim();
  const wompiPaymentLinkId = String(formData.get("wompiPaymentLinkId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  const amountInCentsRaw = Number(String(formData.get("amountInCents") || "0"));
  const amountInCents = Number.isFinite(amountInCentsRaw) ? Math.trunc(amountInCentsRaw) : 0;
  const currency = String(formData.get("currency") || "").trim().toUpperCase();
  if (!wompiTransactionId && !reference && !wompiPaymentLinkId && !paymentId) return;
  await reconcilePaymentAction({
    wompiTransactionId: wompiTransactionId || undefined,
    reference: reference || undefined,
    paymentId: paymentId || undefined,
    wompiPaymentLinkId: wompiPaymentLinkId || undefined,
    tenantId: tenantId || undefined,
    amountInCents: amountInCents > 0 ? amountInCents : undefined,
    currency: currency || undefined,
    actorEmail: session.email || undefined
  });
  revalidatePath("/logs");
  revalidatePath("/payments");
}

async function associatePayment(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const session = await getSuperAdminSession();
  if (!session) return;
  const returnTo = safeReturnToLogs(formData);
  const paymentId = String(formData.get("paymentId") || "").trim();
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const cycleId = String(formData.get("cycleId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!paymentId || (!subscriptionId && !cycleId)) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}assoc=fail&assocError=missing_ids`);
  }
  const res = await associatePaymentToSubscription({
    paymentId,
    subscriptionId,
    cycleId,
    tenantId: tenantId || undefined,
    actorEmail: session.email || undefined
  });
  if (!res.ok) {
    const err = res.error || "failed";
    if (err === "out_of_cycle" && (res as any).details) {
      const details = (res as any).details;
      const fmt = (value: any) =>
        value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(new Date(value)) : "—";
      const paidAt = fmt(details.paidAt);
      const start = fmt(details.periodStart);
      const end = fmt(details.periodEnd);
      redirect(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}assoc=fail&assocError=${encodeURIComponent(
          `Fuera de ciclo: pago ${paidAt} · ciclo ${start} → ${end}`
        )}`
      );
    }
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}assoc=fail&assocError=${encodeURIComponent(err)}`);
  }
  revalidatePath("/logs");
  revalidatePath("/payments");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}assoc=ok`);
}

async function reconcilePendingPayments(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  if (!(await getSuperAdminSession())) return;
  const returnTo = safeReturnToLogs(formData);
  const tenantId = String(formData.get("tenantId") || "").trim();
  const daysRaw = Number(String(formData.get("days") || "7"));
  const minutesRaw = Number(String(formData.get("minutes") || "720"));
  const takeRaw = Number(String(formData.get("take") || "100"));
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.trunc(daysRaw), 1), 30) : 7;
  const minutes = Number.isFinite(minutesRaw) ? Math.min(Math.max(Math.trunc(minutesRaw), 10), 60 * 24 * 30) : 720;
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 100;
  try {
    await recollectPayments({ days, take: Math.max(200, take) });
    await reconcilePendingPaymentsAction({ minutes, take, ...(tenantId ? { tenantId } : {}) });
    revalidatePath("/logs");
    revalidatePath("/payments");
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}recollect=ok&days=${days}&minutes=${minutes}&take=${take}`
    );
  } catch (err: any) {
    const message = String(err?.message || err || "recollect_failed");
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}recollect=fail&recollectError=${encodeURIComponent(message)}`
    );
  }
}

async function autoAssociatePayments(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  const session = await getSuperAdminSession();
  if (!session) return;
  const returnTo = safeReturnToLogs(formData);
  const tenantId = String(formData.get("tenantId") || "").trim();
  const from = String(formData.get("from") || "").trim();
  const to = String(formData.get("to") || "").trim();
  const takeRaw = Number(String(formData.get("take") || "300"));
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 50), 2000) : 300;
  try {
    const res = await autoAssociateUnlinkedPayments({
      tenantId: tenantId || undefined,
      from: from || undefined,
      to: to || undefined,
      take,
      actorEmail: session.email || undefined
    });
    revalidatePath("/logs");
    revalidatePath("/payments");
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}assocAll=ok&assocAllCount=${res.associated}&assocAllSkipped=${res.skipped}&assocAllFailed=${res.failed}`
    );
  } catch (err: any) {
    const message = String(err?.message || err || "assoc_all_failed");
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}assocAll=fail&assocAllError=${encodeURIComponent(message)}`
    );
  }
}

function safeReturnToLogs(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  if (raw.startsWith("/logs") || raw.startsWith("/payments")) return raw;
  return "/logs?tab=payments";
}

async function forwardShopifyPayment(formData: FormData) {
  "use server";
  await assertCsrfToken(formData);
  if (!(await getSuperAdminSession())) return;
  const paymentId = String(formData.get("paymentId") || "").trim();
  const returnTo = safeReturnToLogs(formData);
  if (!paymentId) return;
  const res = await enqueueShopifyForwardForPayment({ paymentId });
  if (!res.ok) {
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}shopifyError=${encodeURIComponent(String(res.error || "unknown_error"))}`
    );
  }
  redirect(
    `${returnTo}${returnTo.includes("?") ? "&" : "?"}shopifyResent=${encodeURIComponent(res.queued ? "queued" : "exists")}`
  );
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

function paymentOriginLabel(origin?: string | null) {
  const s = String(origin || "").toUpperCase();
  if (s === "AUTO_DEBIT") return "Auto débito";
  if (s === "AUTO_LINK") return "Auto link";
  if (s === "MANUAL_LINK") return "Link manual";
  if (s === "MANUAL_USER") return "Manual (usuario)";
  if (s === "WEBHOOK") return "Webhook";
  return s || "—";
}

function paymentAssociationLabel(reason?: string | null) {
  const s = String(reason || "").toUpperCase();
  if (s === "LINK_MATCH") return "Link";
  if (s === "TX_MATCH") return "Transacción";
  if (s === "REF_MATCH") return "Referencia";
  if (s === "SUB_REF") return "Ref suscripción";
  if (s === "IDENTITY_MATCH") return "Identidad";
  if (s === "MANUAL_RECONCILE") return "Reconciliación manual";
  if (s === "UNLINKED") return "Sin suscripción";
  if (s === "UNKNOWN") return "Desconocido";
  return s || "—";
}

export default async function LogsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  // VERIFICAR QUE SOLO SUPER ADMIN PUEDE VER LOGS
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  if (session?.role !== "SUPER_ADMIN") {
    // Redirigir usuarios normales a settings (sus notificaciones están allí)
    redirect("/settings?tab=notificaciones");
  }

  const sp = (await searchParams) ?? {};
  const tabRaw = typeof sp.tab === "string" ? sp.tab : "system";
  const allowedTabs = new Set(["system", "webhooks", "messages", "payments"]);
  const tab = allowedTabs.has(tabRaw) ? tabRaw : "system";
  const routeBase = tab === "payments" ? "/payments" : "/logs";
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const paymentsView = typeof sp.paymentsView === "string" ? sp.paymentsView : "";
  const level = typeof sp.level === "string" ? sp.level : "";
  const processStatus = typeof sp.processStatus === "string" ? sp.processStatus : "";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
  const defaultFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const defaultTo = new Date().toISOString().slice(0, 10);
  const from = typeof sp.from === "string" && sp.from.trim() ? sp.from : defaultFrom;
  const to = typeof sp.to === "string" && sp.to.trim() ? sp.to : defaultTo;
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const shopifyResent = typeof sp.shopifyResent === "string" ? sp.shopifyResent : "";
  const shopifyError = typeof sp.shopifyError === "string" ? sp.shopifyError : "";
  const recollectStatus = typeof sp.recollect === "string" ? sp.recollect : "";
  const recollectError = typeof sp.recollectError === "string" ? sp.recollectError : "";
  const assocStatus = typeof sp.assoc === "string" ? sp.assoc : "";
  const assocError = typeof sp.assocError === "string" ? sp.assocError : "";
  const assocAllStatus = typeof sp.assocAll === "string" ? sp.assocAll : "";
  const assocAllError = typeof sp.assocAllError === "string" ? sp.assocAllError : "";
  const assocAllCount = typeof sp.assocAllCount === "string" ? sp.assocAllCount : "";
  const assocAllSkipped = typeof sp.assocAllSkipped === "string" ? sp.assocAllSkipped : "";
  const assocAllFailed = typeof sp.assocAllFailed === "string" ? sp.assocAllFailed : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  let resolvedIds: string[] | null = null;
  if ((viewId || filters) && (tab === "system" || tab === "payments")) {
    const scope = tab === "payments" ? "payments" : "logs";
    const parsedFilters = filters ? parseFiltersParam(filters) : null;
    resolvedIds = await resolveSmartViewIds(scope, tenantId || null, null, viewId || undefined, parsedFilters || undefined);
  }
  const systemIds = tab === "system" && resolvedIds && resolvedIds.length ? resolvedIds : undefined;
  const paymentIds = tab === "payments" && resolvedIds && resolvedIds.length ? resolvedIds : undefined;

  const emptyList = { items: [], total: null };
  const system = tab === "system" ? await listSystemLogs({ take, skip, q, level, from, to, ids: systemIds, withCount: true }) : emptyList;
  const webhooks =
    tab === "webhooks"
      ? await listWebhookEvents({ take, skip, q, processStatus, from, to, tenantId, withCount: true })
      : { items: [], total: null };
  const messages = tab === "messages" ? await listChatwootMessages({ take, skip, from, to, withCount: true }) : emptyList;
  const payments =
    tab === "payments"
      ? await listPaymentLogs({
          take,
          skip,
          q,
          status: paymentsView ? paymentsView : status,
          from,
          to,
          tenantId,
          ids: paymentIds,
          withCount: true
        })
      : emptyList;
  const paymentsHealth = tab === "payments" ? await getPaymentsHealth() : null;
  const settingsRes = await getAdminSettings();
  const aiConfig = settingsRes?.ai || null;
  const aiProviders = aiConfig?.providers || null;
  const aiEnabled = Boolean(aiConfig?.enabled && (aiProviders?.openai?.configured || aiProviders?.deepseek?.configured));

  const returnTo = `${routeBase}?${new URLSearchParams({
    tab,
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(paymentsView ? { paymentsView } : {}),
    ...(level ? { level } : {}),
    ...(processStatus ? { processStatus } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;

  const sysItems = (system.items ?? []) as any[];
  const webhookItems = (webhooks.items ?? []) as any[];
  const messageItems = (messages.items ?? []) as any[];
  const paymentItems = (payments.items ?? []) as any[];
  const totals = {
    system: typeof system.total === "number" ? system.total : null,
    webhooks: typeof webhooks.total === "number" ? webhooks.total : null,
    messages: typeof messages.total === "number" ? messages.total : null,
    payments: typeof payments.total === "number" ? payments.total : null
  };
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

  const paymentsHealthInfo = paymentsHealth || null;
  const paymentsConfig = settingsRes?.paymentsConfig || null;

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
          : tab === "payments"
              ? paymentItems.length
              : webhookItems.length;
    const totalCount =
      tab === "system"
        ? totals.system
        : tab === "messages"
          ? totals.messages
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
    const pages: number[] = [];
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
      ...(tab === "payments" && paymentsView ? { paymentsView } : {}),
      ...(tab === "webhooks" && processStatus ? { processStatus } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(tenantId ? { tenantId } : {}),
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
        <div className="pagination-pages" style={{ display: "none" }} />
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

  const headerSummary =
    tab === "system" ? (
      <div className="panelHeaderPills">
        <span className="pill">Total {totals.system ?? normalized.length}</span>
        <span className="pill pill-ok">Info {systemSummary.info}</span>
        <span className="pill pill-warn">Alertas {systemSummary.warn}</span>
        <span className="pill pill-bad">Errores {systemSummary.error}</span>
      </div>
    ) : tab === "webhooks" ? (
      <div className="panelHeaderPills">
        <span className="pill">Total {totals.webhooks ?? webhooksSummary.total}</span>
        <span className="pill pill-ok">Procesados {webhooksSummary.processed}</span>
        <span className="pill pill-warn">Recibidos {webhooksSummary.skipped}</span>
        <span className="pill pill-bad">Fallidos {webhooksSummary.failed}</span>
      </div>
    ) : tab === "messages" ? (
      <div className="panelHeaderPills">
        <span className="pill">Total {totals.messages ?? messageItems.length}</span>
        <span className="pill pill-ok">Enviados {messageSummary.sent}</span>
        <span className="pill pill-warn">Pendientes {messageSummary.pending}</span>
        <span className="pill pill-bad">Fallidos {messageSummary.failed}</span>
      </div>
    ) : (
      <div className="panelHeaderPills">
        <span className="pill">Total {totals.payments ?? paymentsSummary.total}</span>
        <span className="pill pill-ok">Pagados {paymentsSummary.approved}</span>
        <span className="pill pill-warn">Pendientes {paymentsSummary.pending}</span>
        <span className="pill pill-bad">Fallidos {paymentsSummary.failed}</span>
      </div>
    );

  const headerSearch =
    tab === "payments" ? (
      <form action="/payments" method="GET" className="filtersForm filtersSearch" data-debounce-form="true">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {paymentsView ? <input type="hidden" name="paymentsView" value={paymentsView} /> : null}
        {from ? <input type="hidden" name="from" value={from} /> : null}
        {to ? <input type="hidden" name="to" value={to} /> : null}
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
        {filters ? <input type="hidden" name="filters" value={filters} /> : null}
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar cliente, referencia o transacción..."
          aria-label="Buscar pagos"
          title="Busca por cliente, referencia o transacción"
        />
        <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
      </form>
    ) : (
      <form action="/logs" method="GET" className="filtersForm filtersSearch" data-debounce-form="true">
        <input type="hidden" name="tab" value={tab} />
        {level ? <input type="hidden" name="level" value={level} /> : null}
        {processStatus ? <input type="hidden" name="processStatus" value={processStatus} /> : null}
        {from ? <input type="hidden" name="from" value={from} /> : null}
        {to ? <input type="hidden" name="to" value={to} /> : null}
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
        {filters ? <input type="hidden" name="filters" value={filters} /> : null}
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar eventos, fuente o cliente..."
          aria-label="Buscar logs"
          title="Buscar logs"
        />
        <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
      </form>
    );

  const headerSmartViews =
    tab === "payments" ? (
      <SmartViewsBar
        scope="payments"
        initialViewId={viewId}
        initialFilters={filters}
        compactInline
        hideFilterButton
        baseParams={{
          ...(q ? { q } : {}),
          ...(paymentsView ? { paymentsView } : {})
        }}
        initialFields={getSmartViewFields("payments")}
      />
    ) : tab === "system" ? (
      <SmartViewsBar
        scope="logs"
        initialViewId={viewId}
        initialFilters={filters}
        compactInline
        hideFilterButton
        baseParams={{
          tab: "system",
          ...(q ? { q } : {}),
          ...(level ? { level } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {})
        }}
        initialFields={getSmartViewFields("logs")}
      />
    ) : null;

  const headerFilterButton =
    tab === "payments" ? (
      <FilterButton
        scope="payments"
        baseParams={{
          ...(q ? { q } : {}),
          ...(paymentsView ? { paymentsView } : {}),
          ...(status ? { status } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(tenantId ? { tenantId } : {}),
          ...(viewId ? { viewId } : {}),
          ...(filters ? { filters } : {})
        }}
        initialFields={getSmartViewFields("payments")}
      />
    ) : tab === "system" ? (
      <FilterButton
        scope="logs"
        baseParams={{
          tab: "system",
          ...(q ? { q } : {}),
          ...(level ? { level } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(tenantId ? { tenantId } : {}),
          ...(viewId ? { viewId } : {}),
          ...(filters ? { filters } : {})
        }}
        initialFields={getSmartViewFields("logs")}
      />
    ) : null;

  const headerFilters = (
    <form
      action={tab === "payments" ? "/payments" : "/logs"}
      method="GET"
      className="filtersForm page-header-standard-filters-group"
      data-debounce-form="true"
    >
      {tab !== "payments" ? <input type="hidden" name="tab" value={tab} /> : null}
      {q ? <input type="hidden" name="q" value={q} /> : null}
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
      {filters ? <input type="hidden" name="filters" value={filters} /> : null}
      {tab === "payments" && paymentsView ? <input type="hidden" name="paymentsView" value={paymentsView} /> : null}

      {tab === "webhooks" && (
        <select className="select" name="processStatus" defaultValue={processStatus} style={{ minWidth: 140 }} data-auto-submit="true">
          <option value="">Estado: Todos</option>
          <option value="PROCESSED">Procesados</option>
          <option value="FAILED">Fallidos</option>
          <option value="SKIPPED">Omitidos</option>
        </select>
      )}
      {tab === "messages" && (
        <select className="select" name="status" defaultValue={status} style={{ minWidth: 140 }} data-auto-submit="true">
          <option value="">Estado: Todos</option>
          <option value="SENT">Enviados</option>
          <option value="PENDING">Pendientes</option>
          <option value="FAILED">Fallidos</option>
        </select>
      )}
      {tab === "system" && (
        <select className="select" name="level" defaultValue={level} style={{ minWidth: 140 }} data-auto-submit="true">
          <option value="">Nivel: Todos</option>
          <option value="INFO">Info</option>
          <option value="WARN">Alertas</option>
          <option value="ERROR">Errores</option>
        </select>
      )}
      {tab === "payments" && (
        <select className="select" name="status" defaultValue={status} style={{ minWidth: 140 }} data-auto-submit="true">
          <option value="">Estado: Todos</option>
          <option value="APPROVED">Pagados</option>
          <option value="PENDING">Pendientes</option>
          <option value="FAILED">Fallidos</option>
        </select>
      )}
      <input className="input" type="date" name="from" defaultValue={from} aria-label="Desde" title="Desde" style={{ width: 130 }} data-auto-submit="true" />
      <input className="input" type="date" name="to" defaultValue={to} aria-label="Hasta" title="Hasta" style={{ width: 130 }} data-auto-submit="true" />
    </form>
  );

  const headerViews = null;

  const paymentsCsvActions =
    tab === "payments" ? (
      <ListCsvActions
        exportHref={`/api/list-csv?${new URLSearchParams({
          scope: "payments",
          ...(q ? { q } : {}),
          ...(status ? { status } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(tenantId ? { tenantId } : {})
        }).toString()}`}
        defaultEntity="payments"
      />
    ) : null;

  const paymentsPrimaryActions =
    tab === "payments" ? (
      <div className="payments-header-actions">
        <form action={autoAssociatePayments} className="filtersForm">
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <input type="hidden" name="take" value="500" />
          {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
          <PendingButton className="ghost btn-compact btn-noicon" type="submit" pendingText="Asociando..." title="Asociar pagos no vinculados a suscripciones">
            Asociar pagos
          </PendingButton>
        </form>
        <form action={reconcilePendingPayments} className="filtersForm">
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="days" value="7" />
          <input type="hidden" name="minutes" value="720" />
          <input type="hidden" name="take" value="150" />
          {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
          <PendingButton className="primary btn-compact" type="submit" pendingText="Conciliando..." title="Reintenta conciliación de pagos pendientes">
            Recolectar
          </PendingButton>
        </form>
        <ReconcilePaymentModal csrfToken={csrfToken} action={reconcilePayment} className="primary btn-compact btn-noicon btn-reconcile" />
      </div>
    ) : null;

  return (
    <main className={`page logsPage${tab === "payments" ? " paymentsPage" : ""}`}>
      <LogsFiltersAutoSubmit />

      {/* Tabs de navegación superiores */}
      {tab !== "payments" && (
        <div className="panel-tabs panel-tabs-top" style={{ marginBottom: 0, borderBottom: "1px solid var(--stroke)" }}>
          <Link
            className={`ghost no-icon panel-tab ${tab === "system" ? "is-active" : ""}`}
            href={`/logs?${new URLSearchParams({ tab: "system" })}`}
            title="Eventos internos y auditoría"
            prefetch={false}
          >
            Sistema
          </Link>
          <Link
            className={`ghost no-icon panel-tab ${tab === "webhooks" ? "is-active" : ""}`}
            href={`/logs?${new URLSearchParams({ tab: "webhooks" })}`}
            title="Entradas y reintentos de webhooks"
            prefetch={false}
          >
            Webhooks
          </Link>
          <Link
            className={`ghost no-icon panel-tab ${tab === "messages" ? "is-active" : ""}`}
            href={`/logs?${new URLSearchParams({ tab: "messages" })}`}
            title="Mensajes enviados por integraciones"
            prefetch={false}
          >
            Mensajes
          </Link>
        </div>
      )}

      {tab === "payments" && (
        <div className="panel-tabs panel-tabs-top" style={{ marginBottom: 0, borderBottom: "1px solid var(--stroke)" }}>
          <Link
            className={`ghost no-icon panel-tab ${paymentsView === "RECEIVED" ? "is-active" : ""}`}
            href={`/payments?${new URLSearchParams({
              paymentsView: "RECEIVED",
              ...(q ? { q } : {}),
              ...(from ? { from } : {}),
              ...(to ? { to } : {}),
              ...(tenantId ? { tenantId } : {}),
              ...(viewId ? { viewId } : {}),
              ...(filters ? { filters } : {})
            }).toString()}`}
            prefetch={false}
          >
            Pagos recibidos
          </Link>
          <Link
            className={`ghost no-icon panel-tab ${paymentsView === "REQUESTED" ? "is-active" : ""}`}
            href={`/payments?${new URLSearchParams({
              paymentsView: "REQUESTED",
              ...(q ? { q } : {}),
              ...(from ? { from } : {}),
              ...(to ? { to } : {}),
              ...(tenantId ? { tenantId } : {}),
              ...(viewId ? { viewId } : {}),
              ...(filters ? { filters } : {})
            }).toString()}`}
            prefetch={false}
          >
            Pagos solicitados
          </Link>
        </div>
      )}

      {/* Mensajes de notificación */}
      {shopifyResent ? <div className="card cardPad">Reenvío a Shopify encolado.</div> : null}
      {shopifyError ? <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>Error Shopify: {shopifyError}</div> : null}
      {recollectStatus === "ok" ? <div className="card cardPad">Recolectar pagos ejecutado.</div> : null}
      {recollectStatus === "fail" ? <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>Error recolectando pagos: {recollectError || "unknown_error"}</div> : null}
      {assocStatus === "ok" ? <div className="card cardPad">Pago asociado manualmente a la suscripción.</div> : null}
      {assocStatus === "fail" ? <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>Error asociando pago: {assocError || "unknown_error"}</div> : null}
      {assocAllStatus === "ok" ? (
        <div className="card cardPad">
          Asociaciones automáticas completadas. Asociados: {assocAllCount || "0"} · Omitidos: {assocAllSkipped || "0"} · Fallidos: {assocAllFailed || "0"}
        </div>
      ) : null}
      {assocAllStatus === "fail" ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error asociando pagos: {assocAllError || "unknown_error"}
        </div>
      ) : null}

      <section className="settings-group">
        <PageToolbar
          className="compact"
          search={headerSearch}
          searchActions={headerFilterButton || undefined}
          filters={headerFilters}
          views={headerViews}
          smartViews={headerSmartViews ?? <div />}
          actions={paymentsCsvActions || undefined}
          summary={tab === "payments" ? paymentsPrimaryActions : headerSummary}
        />

        {/* Panel de salud del sistema (solo non-payments) */}
        {tab !== "payments" && (
          <div className="filtersPanel payments-health-panel" style={{ marginBottom: 16 }}>
            {(() => {
              if (tab === "payments") return null;
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
        )}

        <div className="settings-group-body">
          {aiEnabled ? (
            <div className="logs-ai-wrapper">
              <AiAssistant from={from} to={to} tenantId={tenantId || undefined} scope="logs" />
            </div>
          ) : null}
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
          ) : tab === "payments" ? (
            <div className="panel module" style={{ padding: 0 }}>
              <div className="payments-table-wrap">
              <table className="table logs-table logs-table-payments" aria-label="Tabla de pagos">
                <colgroup>
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "190px" }} />
                  <col style={{ width: "180px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "160px" }} />
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
                    <th>Notificación</th>
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
                    const providerResponse =
                      p.providerResponse && typeof p.providerResponse === "object" ? (p.providerResponse as any) : null;
                    const reconciliation = providerResponse?.reconciliation && typeof providerResponse.reconciliation === "object"
                      ? providerResponse.reconciliation
                      : null;
                    const sourceRaw = String(
                      reconciliation?.source ||
                        reconciliation?.origin ||
                        providerResponse?.provider ||
                        providerResponse?.source ||
                        ""
                    ).toLowerCase();
                    const externalSourceLabel = sourceRaw.includes("shopify")
                      ? "Shopify"
                      : sourceRaw.includes("wompi")
                        ? "Wompi"
                        : sourceRaw
                          ? sourceRaw.toUpperCase()
                          : "Sin identificar";
                    const referenceText = String(p.reference || "").trim();
                    const isShopifyPayment = sourceRaw.includes("shopify") || (referenceText ? classifyReference(referenceText).kind === "shopify" : false);
                    const ignoredReason = String(p?.reconciliation?.reason || "").trim();
                    const wompiTxText = String(p.wompiTransactionId || "").trim();
                    const wompiLinkText = String(p.wompiPaymentLinkId || "").trim();
                    const isExternal = !p.subscriptionId;
                    const isRequestedLink =
                      isExternal &&
                      (Boolean(p.wompiPaymentLinkId) ||
                        Boolean(p.checkoutUrl) ||
                        referenceText.startsWith("ORDER_") ||
                        ["MANUAL_LINK", "AUTO_LINK"].includes(String(p.origin || "").toUpperCase()));
                    const planName = p.subscription?.plan?.name
                      ? p.subscription.plan.name
                      : isRequestedLink
                        ? "Pago solicitado (link de pago)"
                        : isExternal
                          ? `Pago externo (${externalSourceLabel})`
                          : "Falta asociar suscripción";
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
                      ? `Pago externo (${externalSourceLabel})${ignoredReason ? ` · ${ignoredReason}` : ""}`
                      : failureReason;
                    const originLabel = paymentOriginLabel(p.origin);
                    const associationLabel = paymentAssociationLabel(p.associationReason);
                    const traceLabel = [originLabel, associationLabel, p.associatedBy].filter(Boolean).join(" · ");
                    const originKey = String(p.origin || "").toUpperCase();
                    const assocKey = String(p.associationReason || "").toUpperCase();
                    const originChipClass =
                      originKey === "MANUAL_USER"
                        ? "pill-warn"
                        : originKey === "AUTO_DEBIT" || originKey === "AUTO_LINK"
                          ? "pill-ok"
                          : originKey === "MANUAL_LINK"
                            ? "pill-warn"
                            : originKey === "WEBHOOK"
                              ? "pill-muted"
                              : "pill-muted";
                    const assocChipClass =
                      assocKey === "UNLINKED"
                        ? "pill-bad"
                        : assocKey === "MANUAL_RECONCILE"
                          ? "pill-warn"
                          : assocKey
                            ? "pill-ok"
                            : "pill-muted";
                    const notif = p.notification;
                    const notifStatus = String(notif?.status || "").toUpperCase();
                    const notifType = String(notif?.type || "").toUpperCase();
                    const notifOffset = Number((notif as any)?.providerResp?.meta?.offsetSeconds ?? 0);
                    const notifLabel =
                      notifType === "PAYMENT_LINK"
                        ? "Link de pago"
                        : notifType === "EXPIRY_WARNING"
                          ? notifOffset > 0
                            ? "Mora"
                            : "Recordatorio de pago"
                          : "Notificación";
                    const notifChip =
                      notifStatus === "SENT"
                        ? { cls: "is-success", label: "Enviado" }
                        : notifStatus === "FAILED"
                          ? { cls: "is-error", label: "Fallido" }
                          : notifStatus
                            ? { cls: "is-warning", label: "Pendiente" }
                            : null;
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
                        <td className="log-status-cell">
                          {notifChip ? (
                            <div className="log-notif-stack">
                              <span className={`status-chip ${notifChip.cls}`} title={notifLabel}>
                                <span className={`status-led ${notifChip.cls === "is-success" ? "is-ok" : ""}`} />
                                {notifLabel} · {notifChip.label}
                              </span>
                              <span className="pill pill-sm pill-muted">WhatsApp</span>
                            </div>
                          ) : (
                            "—"
                          )}
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
                          {traceLabel ? <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{traceLabel}</div> : null}
                          {originLabel || associationLabel ? (
                            <div className="log-trace-badges">
                              {originLabel ? <span className={`pill pill-sm ${originChipClass}`}>Origen: {originLabel}</span> : null}
                              {associationLabel ? <span className={`pill pill-sm ${assocChipClass}`}>Asociación: {associationLabel}</span> : null}
                              {p.associatedBy ? <span className="pill pill-sm pill-muted">Por: {p.associatedBy}</span> : null}
                            </div>
                          ) : null}
                        </td>
                        <td className="log-payment-actions-cell">
                          <div className="log-payment-actions">
                            {String(p.status || "").toUpperCase() === "PENDING" ? (
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
                            {isShopifyPayment ? (
                              <form action={forwardShopifyPayment}>
                                <input type="hidden" name="csrf" value={csrfToken} />
                                <input type="hidden" name="paymentId" value={String(p.id || "")} />
                                <input type="hidden" name="returnTo" value={returnTo} />
                                <PendingButton className="ghost btn-compact btn-noicon" type="submit" pendingText="Reenviando...">
                                  Reenviar a Shopify
                                </PendingButton>
                              </form>
                            ) : null}
                            {!p.subscriptionId && (contactId || contactQuery) ? (
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
                            {!p.subscriptionId ? (
                              <form action={associatePayment} className="log-associate-form">
                                <input type="hidden" name="csrf" value={csrfToken} />
                                <input type="hidden" name="paymentId" value={String(p.id || "")} />
                                <input type="hidden" name="tenantId" value={String(tenantId || p.tenantId || "")} />
                                <input type="hidden" name="returnTo" value={returnTo} />
                                {Array.isArray(p.candidateCycles) && p.candidateCycles.length ? (
                                  <select className="select select-sm" name="cycleId" defaultValue="">
                                    <option value="">Ciclo a asociar…</option>
                                    {p.candidateCycles.map((c: any) => {
                                      const start = c.periodStartAt ? new Date(c.periodStartAt) : null;
                                      const end = c.periodEndAt ? new Date(c.periodEndAt) : null;
                                      const fmt = (d: Date | null) =>
                                        d ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(d) : "—";
                                      return (
                                        <option key={c.id} value={c.id}>
                                          {c.planName || "Plan"} · ciclo {c.cycleNumber} · {fmt(start)} → {fmt(end)}
                                        </option>
                                      );
                                    })}
                                  </select>
                                ) : (
                                  <input
                                    className="input input-sm"
                                    name="subscriptionId"
                                    placeholder="ID suscripción"
                                    aria-label="ID de suscripción"
                                  />
                                )}
                                <PendingButton className="ghost btn-compact btn-noicon" type="submit" pendingText="Asociando...">
                                  Asociar
                                </PendingButton>
                              </form>
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
                      <td colSpan={9} style={{ color: "var(--muted)" }}>
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
