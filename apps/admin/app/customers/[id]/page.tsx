import Link from "next/link";
import { getCustomerWithGamification } from "../../admin/_services/customers";
import { getCustomerPayments, listCustomerBillingCycles } from "../../admin/_services/payments";
import { listSubscriptions } from "../../admin/_services/subscriptions";
import { listSystemLogs } from "../../admin/_services/logs";
import { listTenants } from "../../admin/_services/tenants";
import { getAdminSettings } from "../../admin/_services/settings";
import { listChatwootContactConversations } from "../../admin/_services/chatwoot";
import { resolveTenantId } from "../../admin/_services/tenantResolver";
import { AiAssistant } from "../../logs/AiAssistant";
import { LocalDateTime } from "../../ui/LocalDateTime";
import { PageSection, PageShell } from "../../ui/PageShell";
import { LocationSection } from "../LocationSection";
import { customerErrorText } from "../errors";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { extractCustomerPaymentSourceId, readCustomerMetadata } from "@suscripciones/core/lib/customerMetadata";
import {
  MiniBars,
  MiniDonut,
  MiniLine,
  cleanLogEntity,
  cleanLogMessage,
  collectionLabel,
  compactCustomerLogs,
  epochToIso,
  formatCopFromCents,
  formatProductTitle,
  isRelevantCustomerLog,
  logLevelLabel,
  logPillClass,
  statusLabel,
  statusPillClass,
  tokenMethodLabel
} from "./detailHelpers";
import "../customers.css";

export const dynamic = "force-dynamic";

async function fetchCustomer(id: string, tenantId?: string | null) {
  return getCustomerWithGamification({ customerId: id, tenantId: tenantId || null });
}

async function fetchPayments(id: string, tenantId?: string | null) {
  return getCustomerPayments({ customerId: id, tenantId: tenantId || null, take: 40, skip: 0 });
}

async function fetchSubscriptions(id: string, tenantId?: string | null) {
  return listSubscriptions({ customerId: id, tenantId: tenantId || null, take: 40 });
}

async function fetchBillingCycles(id: string) {
  return listCustomerBillingCycles({ customerId: id, take: 30 });
}

async function fetchLogs(id: string, opts?: { take?: number; from?: string; to?: string }) {
  return listSystemLogs({
    customerId: id,
    take: opts?.take ?? 20,
    from: opts?.from,
    to: opts?.to
  });
}

async function fetchTenants() {
  return listTenants();
}

async function fetchSettings() {
  return getAdminSettings();
}

async function fetchChatwootConversations(contactId: number) {
  return listChatwootContactConversations(contactId);
}

async function geocodeAddress(address: string) {
  if (!address) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "apiflujos-admin/1.0 (contacto@apiflujos.com)"
      },
      cache: "no-store",
      // Sin tope, un Nominatim lento o inalcanzable dejaba la ficha cargando.
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => []);
    const first = Array.isArray(json) ? json[0] : null;
    if (!first) return null;
    return {
      lat: Number(first.lat),
      lon: Number(first.lon),
      label: String(first.display_name || "")
    };
  } catch {
    return null;
  }
}

export default async function CustomerDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const resolvedTenantId = null;
  const rawSearch = (await searchParams) || {};
  const returnTo = resolveReturnTo(rawSearch.returnTo, "/customers");
  const selfHref = withReturnTo(`/customers/${id}`, returnTo);
  const error = customerErrorText(rawSearch.error);
  const sentKind = typeof rawSearch.sent === "string" ? rawSearch.sent : "";
  const noticeText = error
    ? null
    : rawSearch.created
      ? "Contacto creado."
      : rawSearch.updated
        ? "Contacto actualizado."
        : rawSearch.tokenRemoved
          ? "Método de pago removido."
          : sentKind === "link"
            ? "Link de pago enviado."
            : sentKind === "catalog"
              ? "Catálogo enviado."
              : sentKind === "token"
                ? "Link de débito automático enviado."
                : rawSearch.paymentSource
                  ? "Método de pago guardado."
                  : null;
  const logsPage = Math.max(1, Number(rawSearch.logsPage ?? 1));
  const logsWindowDays = 30;
  const logsTo = new Date();
  logsTo.setDate(logsTo.getDate() - logsWindowDays * (logsPage - 1));
  const logsFrom = new Date();
  logsFrom.setDate(logsFrom.getDate() - logsWindowDays * logsPage);
  const logsTake = 20;
  const [customerRes, paymentsRes, subscriptionsRes, logsRes, tenantsRes, settingsRes, cyclesRes] = await Promise.all([
    fetchCustomer(id, resolvedTenantId),
    fetchPayments(id, resolvedTenantId),
    fetchSubscriptions(id, resolvedTenantId),
    fetchLogs(id, { take: logsTake, from: logsFrom.toISOString(), to: logsTo.toISOString() }),
    fetchTenants(),
    fetchSettings(),
    fetchBillingCycles(id)
  ]);

  if (!customerRes.ok) {
    return (
      <PageShell title="Contacto no encontrado" backHref="/customers" backLabel="Volver a contactos">
        <PageSection>No encontramos el contacto solicitado.</PageSection>
      </PageShell>
    );
  }

  const customer = customerRes.ok ? customerRes.customer : null;
  if (!customer) {
    return (
      <PageShell title="Contacto no encontrado" backHref="/customers" backLabel="Volver a contactos">
        <PageSection>No encontramos el contacto solicitado.</PageSection>
      </PageShell>
    );
  }

  const payments = (paymentsRes.ok ? paymentsRes.items : []) as any[];
  const subscriptions = (subscriptionsRes.items ?? []) as any[];
  const logsRaw = (logsRes.items ?? []) as any[];
  const logs = compactCustomerLogs(logsRaw.filter(isRelevantCustomerLog));
  const tenants = (tenantsRes ?? []) as Array<{ id: string; name: string }>;
  const billingCycles = (cyclesRes && (cyclesRes as any).ok ? (cyclesRes as any).items : []) as any[];
  const aiConfig = settingsRes?.ai || null;
  const aiProviders = aiConfig?.providers || null;
  const aiEnabled = Boolean(aiConfig?.enabled && (aiProviders?.openai?.configured || aiProviders?.deepseek?.configured));
  const tenantName = tenants.find((t) => String(t.id) === String(customer.tenantId))?.name || "";
  const tenantNameById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));

  const approvedPayments = payments.filter((p) => p.status === "APPROVED");
  const failedPayments = payments.filter((p) => ["DECLINED", "ERROR", "VOIDED"].includes(String(p.status)));
  const pendingPayments = payments.filter((p) => p.status === "PENDING");
  const totalPaidCents = approvedPayments.reduce((acc, p) => acc + Number(p.amountInCents || 0), 0);
  const lastPayment = payments[0] || null;
  const activeSub = subscriptions.find((s) => s.status === "ACTIVE") || subscriptions[0] || null;
  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE");
  const subscriptionStatusCounts = subscriptions.reduce(
    (acc, s) => {
      const key = String(s?.status || "UNKNOWN");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const subsActiveCount = subscriptionStatusCounts.ACTIVE || 0;
  const subsPastDueCount = subscriptionStatusCounts.PAST_DUE || 0;
  const subsCanceledCount =
    (subscriptionStatusCounts.CANCELED || 0) +
    (subscriptionStatusCounts.CANCELLED || 0) +
    (subscriptionStatusCounts.ENDED || 0);
  const subsOtherCount = Math.max(0, subscriptions.length - (subsActiveCount + subsPastDueCount + subsCanceledCount));
  const subscriptionStatusItems = [
    { label: "Activas", value: subsActiveCount, color: "var(--status-success)" },
    { label: "En mora", value: subsPastDueCount, color: "var(--status-warning)" },
    { label: "Cerradas", value: subsCanceledCount, color: "var(--chart-c)" },
    { label: "Otras", value: subsOtherCount, color: "var(--chart-b)" }
  ].filter((item) => item.value > 0);
  const lastPaymentAt = lastPayment?.paidAt || lastPayment?.createdAt || null;
  const meta = readCustomerMetadata(customer?.metadata);
  const nowTs = Date.now();
  const activeSubCycles = activeSub
    ? billingCycles
        .filter((cycle: any) => String(cycle?.subscriptionId || cycle?.subscription?.id || "") === String(activeSub.id))
        .sort((a: any, b: any) => new Date(b.periodStartAt || 0).getTime() - new Date(a.periodStartAt || 0).getTime())
    : [];
  const activeCycleForSummary =
    activeSubCycles.find((cycle: any) => {
      const startTs = new Date(cycle.periodStartAt || 0).getTime();
      const endTs = new Date(cycle.periodEndAt || 0).getTime();
      return Number.isFinite(startTs) && Number.isFinite(endTs) && startTs <= nowTs && nowTs < endTs;
    }) ||
    activeSubCycles.find((cycle: any) => new Date(cycle.periodStartAt || 0).getTime() <= nowTs) ||
    activeSubCycles[0] ||
    null;
  const nextPeriodEnd = activeCycleForSummary?.periodEndAt || null;
  const paymentSourceId = extractCustomerPaymentSourceId(meta);
  const activePlanLabel = activeSub ? formatProductTitle(activeSub?.product, activeSub?.plan) : "Sin producto activo";
  const tokenMethod = tokenMethodLabel(meta);
  const chatwootMeta = meta?.chatwoot && typeof meta.chatwoot === "object" ? (meta.chatwoot as Record<string, unknown>) : null;
  const documentLabel = String(
    meta?.identificacion ||
      meta?.identificationNumber ||
      meta?.documentNumber ||
      meta?.documento ||
      meta?.document ||
      ""
  ).trim();
  const chatwootContactId = Number(chatwootMeta?.contactId || 0);

  const amountSeries = payments
    .slice(0, 12)
    .reverse()
    .map((p) => Number(p.status === "APPROVED" ? p.amountInCents || 0 : 0));

  const approvedSorted = approvedPayments
    .map((p) => ({
      ...p,
      _at: new Date(p.paidAt || p.createdAt).getTime()
    }))
    .filter((p) => Number.isFinite(p._at))
    .sort((a, b) => a._at - b._at);
  const paymentIntervals = approvedSorted.slice(1).map((p, idx) => {
    const prev = approvedSorted[idx];
    return (p._at - prev._at) / (1000 * 60 * 60 * 24);
  });
  const avgDaysBetween = paymentIntervals.length
    ? paymentIntervals.reduce((acc, v) => acc + v, 0) / paymentIntervals.length
    : null;
  const cadenceSeries = paymentIntervals.slice(-6);
  const cadenceItems = cadenceSeries.map((v, idx) => ({
    label: `-${cadenceSeries.length - idx}`,
    value: Math.max(0, Math.round(v)),
    color: "var(--chart-b)"
  }));
  const daysSinceLast = lastPaymentAt ? Math.floor((Date.now() - new Date(lastPaymentAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
  const avgTicket = approvedPayments.length ? Math.round(totalPaidCents / approvedPayments.length) : 0;
  const approvedLast30 = approvedPayments.filter((p) => {
    const at = new Date(p.paidAt || p.createdAt).getTime();
    if (!Number.isFinite(at)) return false;
    return at >= Date.now() - 30 * 24 * 60 * 60 * 1000;
  }).length;

  const addressMeta = meta?.address && typeof meta.address === "object" ? (meta.address as Record<string, unknown>) : null;
  const geoMeta = meta?.geo && typeof meta.geo === "object" ? (meta.geo as Record<string, unknown>) : null;
  const locationMeta = meta?.location && typeof meta.location === "object" ? (meta.location as Record<string, unknown>) : null;
  const addressParts = [
    addressMeta?.line1,
    addressMeta?.city,
    addressMeta?.dept,
    addressMeta?.code5
  ].filter(Boolean);
  const addressLabel = addressParts.join(", ");
  const directLat = Number(addressMeta?.lat ?? geoMeta?.lat ?? locationMeta?.lat);
  const directLon = Number(addressMeta?.lon ?? addressMeta?.lng ?? geoMeta?.lon ?? geoMeta?.lng ?? locationMeta?.lon ?? locationMeta?.lng);
  const geo =
    Number.isFinite(directLat) && Number.isFinite(directLon)
      ? { lat: directLat, lon: directLon, label: addressLabel }
      : await geocodeAddress(addressLabel);

  const addressDisplay = geo?.label || addressLabel || "";
  const mapLink =
    geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)
      ? `https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=15/${geo.lat}/${geo.lon}`
      : "";

  const recentPayments = payments.slice(0, 5);
  const formatWindowLabel = (fromDate: Date, toDate: Date) =>
    `${fromDate.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })} - ${toDate.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}`;

  const monthLabels = Array.from({ length: 6 }).map((_, idx) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - idx));
    return d.toLocaleDateString("es-CO", { month: "short" });
  });
  const monthlyCounts = monthLabels.map(() => 0);
  approvedPayments.forEach((p) => {
    const created = new Date(p.createdAt);
    if (!Number.isFinite(created.getTime())) return;
    const d = new Date();
    const diffMonths = (d.getFullYear() - created.getFullYear()) * 12 + (d.getMonth() - created.getMonth());
    if (diffMonths < 0 || diffMonths > 5) return;
    monthlyCounts[5 - diffMonths] += 1;
  });

  const logCounts = logs.reduce(
    (acc: { info: number; warn: number; error: number }, l: any) => {
      const lvl = String(l.level || "").toUpperCase();
      if (lvl === "ERROR") acc.error += 1;
      else if (lvl === "WARN" || lvl === "WARNING") acc.warn += 1;
      else acc.info += 1;
      return acc;
    },
    { info: 0, warn: 0, error: 0 }
  );

  const chatwootRes = chatwootContactId ? await fetchChatwootConversations(chatwootContactId) : null;
  const chatwootConvos = chatwootRes?.ok && Array.isArray(chatwootRes.payload?.payload) ? chatwootRes.payload.payload : [];
  const chatwootConvosSorted = [...chatwootConvos].sort((a, b) => {
    const aT = Number(a?.last_activity_at || a?.updated_at || a?.created_at || 0);
    const bT = Number(b?.last_activity_at || b?.updated_at || b?.created_at || 0);
    return bT - aT;
  });
  const chatwootRecent = chatwootConvosSorted.slice(0, 3);
  const chatwootStatusCounts = chatwootConvos.reduce(
    (acc: { open: number; pending: number; resolved: number; snoozed: number }, c: any) => {
      const st = String(c?.status || "").toLowerCase();
      if (st === "resolved") acc.resolved += 1;
      else if (st === "pending") acc.pending += 1;
      else if (st === "snoozed") acc.snoozed += 1;
      else acc.open += 1;
      return acc;
    },
    { open: 0, pending: 0, resolved: 0, snoozed: 0 }
  );
  const chatwootLastActivity = chatwootConvosSorted[0]?.last_activity_at || chatwootConvosSorted[0]?.updated_at || null;

  return (
    <PageShell
      title={customer.name || customer.email || customer.phone || "Contacto"}
      subtitle={<>ID <span className="mono">{customer.id}</span></>}
      crumbs={[{ label: "Contactos", href: returnTo }, { label: customer.name || customer.email || customer.phone || "Contacto" }]}
      backHref={returnTo}
      width="full"
      notice={error ? { tone: "error", text: error } : noticeText ? { tone: "ok", text: noticeText } : null}
      headerActions={
        <div className="customers-detail-actions">
          <Link className="primary btn-compact" href={withReturnTo(`/customers/${customer.id}/edit`, selfHref)}>Editar</Link>
          <Link className="ghost btn-compact" href={withReturnTo(`/customers/${customer.id}/new-subscription`, selfHref)}>Crear suscripción</Link>
          <Link className="ghost btn-compact" href={withReturnTo(`/customers/${customer.id}/send/catalog`, selfHref)}>Enviar catálogo</Link>
          {activeSub ? (
            <Link className="ghost btn-compact" href={withReturnTo(`/customers/${customer.id}/send/link`, selfHref)}>Enviar link de pago</Link>
          ) : null}
          {activeSub ? (
            <Link className="ghost btn-compact" href={withReturnTo(`/customers/${customer.id}/send/token`, selfHref)}>Enviar débito automático</Link>
          ) : null}
          <Link className="ghost btn-compact" href={withReturnTo(`/customers/${customer.id}/payment-method`, selfHref)}>Método de pago</Link>
          {Number.isFinite(paymentSourceId) ? (
            <Link className="ghost btn-compact btn-red" href={withReturnTo(`/customers/${customer.id}/remove-token`, selfHref)}>Quitar token</Link>
          ) : null}
        </div>
      }
    >
      <PageSection>
        <div className="contact-tags">
          {Number.isFinite(paymentSourceId) ? (
            <>
              <span className="pill pill-ok pill-sm">Tokenizada</span>
              {tokenMethod ? <span className="token-method-hint">{tokenMethod}</span> : null}
            </>
          ) : (
            <span className="pill pill-bad pill-sm">Sin token</span>
          )}
          {activeSub ? (
            <span className={`pill pill-sm ${statusPillClass(String(activeSub.status || ""))}`}>
              {collectionLabel(String(activeSub?.plan?.collectionMode || activeSub?.plan?.metadata?.collectionMode || ""))} · {statusLabel(String(activeSub.status || ""))}
            </span>
          ) : (
            <span className="pill pill-muted pill-sm">Sin suscripciones</span>
          )}
          {geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) ? (
            <a className="pill pill-sm pill-muted" href="#ubicacion">Ubicación</a>
          ) : null}
        </div>
        <div className="contact-subline">
          NIT / ID <span className="mono">{documentLabel || "—"}</span> · Canal {tenantName || customer.tenantId || "—"}
        </div>
      </PageSection>

      {geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) ? (
        <div id="ubicacion">
          <PageSection title="Ubicación" description={addressDisplay || "Coordenadas registradas"}>
            <LocationSection lat={geo.lat} lon={geo.lon} label={addressDisplay || undefined} mapLink={mapLink || undefined} />
          </PageSection>
        </div>
      ) : null}

      <section className="card cardPad customer-section">
        <div className="contact-section-title">Puntualidad de pagos (ciclos)</div>
        {billingCycles.length ? (
          <div>
            <table className="customers-table">
              <colgroup>
                <col style={{ width: "12%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "24%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Ciclo</th>
                  <th>Periodo</th>
                  <th>Pago</th>
                  <th>Puntualidad</th>
                  <th>Suscripción</th>
                </tr>
              </thead>
              <tbody>
                {billingCycles.map((c: any) => {
                  const punctual =
                    c.paidOnTime == null
                      ? "—"
                      : c.paidOnTime
                        ? c.daysEarly && c.daysEarly > 0
                          ? `Temprano (${c.daysEarly}d)`
                          : "A tiempo"
                        : c.daysLate && c.daysLate > 0
                          ? `Tarde (${c.daysLate}d)`
                          : "Tarde";
                  return (
                    <tr key={c.id}>
                      <td data-label="Ciclo">Ciclo {c.cycleNumber}</td>
                      <td data-label="Periodo">
                        <LocalDateTime value={c.periodStartAt} /> · <LocalDateTime value={c.periodEndAt} />
                      </td>
                      <td data-label="Pago">{c.paidAt ? <LocalDateTime value={c.paidAt} /> : "—"}</td>
                      <td data-label="Puntualidad">{punctual}</td>
                      <td data-label="Suscripción" title={formatProductTitle(c.subscription?.product, { name: c.subscription?.plan?.name })}>
                        {formatProductTitle(c.subscription?.product, { name: c.subscription?.plan?.name })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">Sin ciclos registrados.</div>
        )}
      </section>

      <section className="grid3">
        <div className="card cardPad metric-card tone-primary">
          <div className="metric-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1v22M5 6h10a4 4 0 0 1 0 8H7a4 4 0 0 0 0 8h10" />
            </svg>
          </div>
          <div className="metric-label">Pagos aprobados</div>
          <div className="metric-value">{approvedPayments.length}</div>
          <div className="metric-sub">{formatCopFromCents(totalPaidCents)} acumulado</div>
        </div>
        <div className="card cardPad metric-card tone-info">
          <div className="metric-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 8v4l3 3" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <div className="metric-label">Último movimiento</div>
          <div className="metric-value">{lastPaymentAt ? <LocalDateTime value={lastPaymentAt} /> : "—"}</div>
          <div className="metric-sub">{lastPayment ? `Estado ${statusLabel(lastPayment.status)}` : "Sin pagos aún"}</div>
        </div>
        <div className="card cardPad metric-card tone-warning">
          <div className="metric-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l9 5v10l-9 5-9-5V7z" />
            </svg>
          </div>
          <div className="metric-label">Suscripciones</div>
          <div className="metric-value">{subscriptions.length}</div>
          <div className="metric-sub">{activeSub ? activePlanLabel : "Sin suscripción activa"}</div>
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section customer-dual-card">
          <div className="customer-dual">
            <div className="customer-pane">
              <div className="contact-section-title">Información del cliente</div>
              <div className="customer-info-grid">
                <div className="customer-info-card">
                  <div className="customer-info-row">
                    <span className="customer-info-label">Email</span>
                    <span className="customer-info-value truncate">{customer.email || "—"}</span>
                  </div>
                  <div className="customer-info-row">
                    <span className="customer-info-label">Teléfono</span>
                    <span className="customer-info-value">{customer.phone || "—"}</span>
                  </div>
                  <div className="customer-info-row">
                    <span className="customer-info-label">Documento</span>
                    <span className="customer-info-value mono">{documentLabel || "—"}</span>
                  </div>
                </div>
                <div className="customer-info-card">
                  <div className="customer-info-row">
                    <span className="customer-info-label">Canal</span>
                    <span className="customer-info-value">{tenantName || customer.tenantId || "—"}</span>
                  </div>
                  <div className="customer-info-row">
                    <span className="customer-info-label">Creado</span>
                    <span className="customer-info-value"><LocalDateTime value={customer.createdAt} /></span>
                  </div>
                  <div className="customer-info-row">
                    <span className="customer-info-label">Dirección</span>
                    <span className="customer-info-value">{addressDisplay || "—"}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="customer-pane">
              <div className="contact-section-title">Estado comercial</div>
              <div className="commercial-grid">
                <div className="commercial-card">
                  <span className="commercial-label">Suscripción activa</span>
                  <span className="commercial-value">{activePlanLabel}</span>
                  <span className="commercial-meta">{activeSub ? collectionLabel(String(activeSub?.plan?.collectionMode || activeSub?.plan?.metadata?.collectionMode || "")) : "—"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Estado</span>
                  <span className="commercial-value">{activeSub ? statusLabel(String(activeSub.status || "")) : "—"}</span>
                  <span className="commercial-meta">{activeSubs.length ? `${activeSubs.length} suscripción${activeSubs.length > 1 ? "es" : ""}` : "Sin suscripciones activas"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Último pago</span>
                  <span className="commercial-value">{lastPaymentAt ? <LocalDateTime value={lastPaymentAt} /> : "—"}</span>
                  <span className="commercial-meta">{lastPayment ? `Estado ${statusLabel(lastPayment.status)}` : "Sin pagos aún"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Próximo corte</span>
                  <span className="commercial-value">{nextPeriodEnd ? <LocalDateTime value={nextPeriodEnd} /> : "—"}</span>
                  <span className="commercial-meta">{activeSub ? "Ciclo activo" : "Sin ciclo"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Método</span>
                  <span className="commercial-value">{Number.isFinite(paymentSourceId) ? "Tokenizado" : "Sin token"}</span>
                  <span className="commercial-meta">{Number.isFinite(paymentSourceId) ? (tokenMethod || "Pago recurrente habilitado") : "Requiere débito automático"}</span>
                </div>
                <div className="commercial-card">
                  <span className="commercial-label">Recencia</span>
                  <span className="commercial-value">{daysSinceLast == null ? "—" : `${daysSinceLast} días`}</span>
                  <span className="commercial-meta">{approvedLast30 ? `${approvedLast30} pagos 30d` : "Sin pagos 30d"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid3">
        <div className="card cardPad chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Pagos recientes y por mes</div>
              <div className="chart-sub">Últimos 12 aprobados + últimos 6 meses.</div>
            </div>
            <div className="chart-range">{approvedPayments.length} aprobados</div>
          </div>
          <div className="chart-split">
            <div>
              <div className="chart-mini-label">Recientes</div>
              <MiniLine values={amountSeries} formatValue={formatCopFromCents} />
            </div>
            <div>
              <div className="chart-mini-label">Por mes</div>
              <MiniBars
                items={monthLabels.map((label, idx) => ({
                  label,
                  value: monthlyCounts[idx],
                  color: "var(--chart-a)"
                }))}
              />
            </div>
          </div>
          <div className="chart-kpis">
            <span className="chart-kpi">Total <strong>{formatCopFromCents(totalPaidCents)}</strong></span>
            <span className="chart-kpi">Promedio <strong>{formatCopFromCents(approvedPayments.length ? Math.round(totalPaidCents / approvedPayments.length) : 0)}</strong></span>
            <span className="chart-kpi">Pagos 6m <strong>{monthlyCounts.reduce((a, b) => a + b, 0)}</strong></span>
          </div>
        </div>

        <div className="card cardPad chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Estado de pagos</div>
              <div className="chart-sub">Distribución del historial reciente.</div>
            </div>
          </div>
          <div className="chart-donut">
            <MiniDonut
              totalLabel="Pagos"
              items={[
                { label: "Aprobados", value: approvedPayments.length, color: "var(--status-success)" },
                { label: "Pendientes", value: pendingPayments.length, color: "var(--status-warning)" },
                { label: "Fallidos", value: failedPayments.length, color: "var(--status-danger)" }
              ]}
            />
          </div>
          <div className="chart-legend">
            <span><i style={{ background: "var(--status-success)" }} />Aprobados {approvedPayments.length}</span>
            <span><i style={{ background: "var(--status-warning)" }} />Pendientes {pendingPayments.length}</span>
            <span><i style={{ background: "var(--status-danger)" }} />Fallidos {failedPayments.length}</span>
          </div>
        </div>

        <div className="card cardPad chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Suscripciones por estado</div>
              <div className="chart-sub">Resumen del estado actual del cliente.</div>
            </div>
            <div className="chart-range">{subscriptions.length} total</div>
          </div>
          {subscriptionStatusItems.length ? (
            <>
              <MiniBars items={subscriptionStatusItems} />
              <div className="chart-legend">
                {subscriptionStatusItems.map((item) => (
                  <span key={item.label}>
                    <i style={{ background: item.color }} />
                    {item.label} {item.value}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="muted">Sin suscripciones registradas.</div>
          )}
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section">
          <div className="contact-section-title">KPIs comerciales</div>
          <div className="summary-grid compact">
            <div className="summary-item">
              <span className="summary-label">LTV</span>
              <span className="summary-value">{formatCopFromCents(totalPaidCents)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Ticket promedio</span>
              <span className="summary-value">{formatCopFromCents(avgTicket)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Frecuencia pago</span>
              <span className="summary-value">{avgDaysBetween == null ? "—" : `${Math.round(avgDaysBetween)} días`}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Recencia</span>
              <span className="summary-value">{daysSinceLast == null ? "—" : `${daysSinceLast} días`}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Aprobados 30 días</span>
              <span className="summary-value">{approvedLast30}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Total pagos</span>
              <span className="summary-value">{payments.length}</span>
            </div>
          </div>
          <div className="kpi-mini-grid">
            <div className="kpi-mini-card">
              <div className="kpi-mini-title">Estado de pagos</div>
              <MiniDonut
                totalLabel="Pagos"
                items={[
                  { label: "Aprobados", value: approvedPayments.length, color: "var(--status-success)" },
                  { label: "Pendientes", value: pendingPayments.length, color: "var(--status-warning)" },
                  { label: "Fallidos", value: failedPayments.length, color: "var(--status-danger)" }
                ]}
              />
            </div>
            {cadenceItems.length ? (
              <div className="kpi-mini-card">
                <div className="kpi-mini-title">Cadencia de pagos (días)</div>
                <MiniBars items={cadenceItems} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="card cardPad customer-section">
          <div className="contact-section-title">Chatwoot</div>
          {!chatwootContactId ? (
            <div className="muted">Sin contacto vinculado en Chatwoot.</div>
          ) : (
            <>
              <div className="summary-grid compact">
                <div className="summary-item">
                  <span className="summary-label">Conversaciones</span>
                  <span className="summary-value">{chatwootConvos.length}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Abiertas</span>
                  <span className="summary-value">{chatwootStatusCounts.open}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Pendientes</span>
                  <span className="summary-value">{chatwootStatusCounts.pending}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Última actividad</span>
                  <span className="summary-value">{chatwootLastActivity ? <LocalDateTime value={epochToIso(chatwootLastActivity) || ""} /> : "—"}</span>
                </div>
              </div>
              {chatwootRecent.length ? (
                <div className="chatwoot-list">
                  {chatwootRecent.map((c: any) => (
                    <div key={c.id} className="chatwoot-item">
                      <div className="chatwoot-item-title">
                        Conversación #{c.id}
                        <span className={`pill pill-sm ${c.status === "resolved" ? "pill-ok" : c.status === "pending" ? "pill-warn" : "pill-muted"}`}>
                          {String(c.status || "open")}
                        </span>
                      </div>
                      <div className="chatwoot-item-meta">
                        <span>Inbox {c.inbox_id || "—"}</span>
                        <span>Canal {c.inbox?.name || "—"}</span>
                        <span>{c.last_activity_at ? <LocalDateTime value={epochToIso(c.last_activity_at) || ""} /> : "—"}</span>
                      </div>
                      {c.last_message?.content || c.messages?.[0]?.content ? (
                        <div className="chatwoot-item-snippet">
                          {String(c.last_message?.content || c.messages?.[0]?.content || "").slice(0, 140)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">Sin conversaciones recientes.</div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section" id="pagos">
          <div className="contact-section-title">Pagos recientes</div>
          {recentPayments.length ? (
            <div>
              <table className="customers-table">
                <colgroup>
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "34%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th>Producto</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p: any) => (
                    <tr key={p.id}>
                      <td data-label="Fecha"><LocalDateTime value={p.paidAt || p.createdAt} /></td>
                      <td data-label="Monto">{formatCopFromCents(Number(p.amountInCents || 0))}</td>
                      <td data-label="Estado" title={String(p.status || "—")}><span className={`pill pill-sm ${statusPillClass(String(p.status || ""))}`}>{statusLabel(String(p.status || ""))}</span></td>
                      <td data-label="Producto" title={formatProductTitle({ name: p.productName }, { name: p.planName })}>
                        {formatProductTitle({ name: p.productName }, { name: p.planName })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">Sin pagos registrados.</div>
          )}
        </div>

        <div className="card cardPad customer-section">
          <div className="contact-section-title">Actividad operativa</div>
          <div className="chart-donut">
            <MiniDonut
              totalLabel="Eventos"
              items={[
                { label: "Info", value: logCounts.info, color: "var(--chart-b)" },
                { label: "Alertas", value: logCounts.warn, color: "var(--status-warning)" },
                { label: "Errores", value: logCounts.error, color: "var(--status-danger)" }
              ]}
            />
          </div>
          <div className="chart-legend">
            <span><i style={{ background: "var(--chart-b)" }} />Info {logCounts.info}</span>
            <span><i style={{ background: "var(--status-warning)" }} />Alertas {logCounts.warn}</span>
            <span><i style={{ background: "var(--status-danger)" }} />Errores {logCounts.error}</span>
          </div>
        </div>
      </section>

      <section className="grid2">
        <div className="card cardPad customer-section timeline-full">
          <div className="contact-section-title">Línea de tiempo del cliente</div>
          <div className="customer-log-controls">
            <span className="muted">{formatWindowLabel(logsFrom, logsTo)}</span>
            <div className="customer-log-actions">
              <Link className="ghost btn-compact" href={`/customers/${customer.id}?logsPage=${logsPage + 1}${returnTo !== "/customers" ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`} data-loader="off">
                Mes anterior
              </Link>
              {logsPage <= 1 ? (
                <span className="ghost btn-compact" aria-disabled="true">
                  Más reciente
                </span>
              ) : (
                <Link className="ghost btn-compact" href={`/customers/${customer.id}?logsPage=${Math.max(1, logsPage - 1)}${returnTo !== "/customers" ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`} data-loader="off">
                  Más reciente
                </Link>
              )}
            </div>
          </div>
          {logs.length ? (
            <div>
              <div>
                <div className="customers-log-list" role="list">
                {logs.map((l: any) => (
                  (() => {
                    const customerLabel = String(customer.name || customer.email || customer.phone || "").trim();
                    const entity = cleanLogEntity(String(l.entity || ""), customerLabel);
                    const message = cleanLogMessage(String(l.message || ""), customerLabel);
                    const tooltip = `${entity}\n${new Date(l.createdAt).toLocaleString("es-CO")} · ${logLevelLabel(String(l.level || ""))}\n${l.source ? `${l.source} · ` : ""}${l.actor || "Sistema"}`;
                    return (
                      <div
                        key={l.id}
                        className="customer-log-item"
                        role="listitem"
                        tabIndex={0}
                        data-tooltip={tooltip}
                        aria-label={tooltip}
                      >
                        <div className="customer-log-title">
                          <span>{entity} {Number(l?.duplicateCount || 1) > 1 ? `x${Number(l.duplicateCount)}` : ""}</span>
                          <span className={`pill pill-sm ${logPillClass(String(l.level || ""))}`}>
                            {logLevelLabel(String(l.level || ""))}
                          </span>
                        </div>
                        <div className="customer-log-message">{message}</div>
                        <div className="customer-log-meta">
                          <span><LocalDateTime value={l.createdAt} /></span>
                          <span>{l.actor || "Sistema"}</span>
                        </div>
                      </div>
                    );
                  })()
                ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="muted">Sin logs en este periodo.</div>
          )}
        </div>
      </section>
      {aiEnabled ? (
        <section className="grid2">
          <div className="card cardPad customer-section timeline-full">
            <div className="contact-section-title">Asistente del cliente</div>
            <AiAssistant
              from={logsFrom.toISOString()}
              to={logsTo.toISOString()}
              customerId={customer.id}
              scope="customer"
              title="Asistente del cliente"
              emptyText="Pregunta por pagos, logs y actividad del contacto. Ej: “¿Hay pagos fallidos este mes?”."
              placeholder="Pregunta sobre este cliente..."
            />
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
