import Link from "next/link";
import { PendingButton } from "../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../ui/PageShell";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { activateSubscription, resumeSubscription } from "../../subscriptions/actions";
import { updateSubscriptionTenants } from "../actions";
import { BillingCyclesPanel } from "../BillingCyclesPanel";
import { PaymentHistoryPanel } from "../PaymentHistoryPanel";
import { formatCivilDate, getCivilDayNumber } from "../civilDate";
import { loadSubscriptionPage, money } from "../subscriptionPage";
import "../billing-pages.css";

export const dynamic = "force-dynamic";

type Tab = "resumen" | "ciclos" | "pagos" | "canales";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "resumen", label: "Resumen" },
  { key: "ciclos", label: "Ciclos" },
  { key: "pagos", label: "Pagos" },
  { key: "canales", label: "Canales" }
];

function statusPill(status: string) {
  if (status === "ACTIVE") return { label: "Activa", cls: "pill-ok" };
  if (status === "PAST_DUE") return { label: "En mora", cls: "pill-bad" };
  if (status === "SUSPENDED") return { label: "Suspendida", cls: "pill-warn" };
  if (status === "CANCELED") return { label: "Cancelada", cls: "pill-muted" };
  if (status === "EXPIRED") return { label: "Expirada", cls: "pill-muted" };
  return { label: "Inactiva", cls: "pill-muted" };
}

/**
 * Detalle de una suscripción. Reemplaza el modal de detalle y los tres modales que
 * se abrían encima de él (editar, historial de pagos y ciclos): ahora son pestañas
 * y páginas de esta misma ruta, con su propia URL.
 */
export default async function SubscriptionDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await loadSubscriptionPage(params, searchParams);
  const { row, csrfToken, sp, tenants, duplicateCount, isDuplicateKeep } = ctx;
  const listHref = resolveReturnTo(sp.returnTo, "/billing");
  const tabRaw = typeof sp.tab === "string" ? sp.tab : "resumen";
  const tab: Tab = (TABS.find((t) => t.key === tabRaw)?.key ?? "resumen") as Tab;

  // Las páginas de acción vuelven a ESTE detalle (en la pestaña en que estabas).
  const detailUrl = ctx.detailHref;
  const to = (path: string) => withReturnTo(`/billing/${encodeURIComponent(row.id)}/${path}`, detailUrl);

  const pill = statusPill(row.status);
  const isAutoDebit = row.mode === "AUTO_DEBIT";
  const isCanceled = row.status === "CANCELED";
  const isSuspended = row.status === "SUSPENDED";
  const isExpired = row.status === "EXPIRED";
  const isReactivatable = isCanceled || isExpired;
  const isInactive = isReactivatable || isSuspended;
  const alreadyPaid = Boolean(row.lastPaidInCurrentPeriod);
  const effectiveChargeDay = getCivilDayNumber(row.currentCollectionDueAt || row.vencimientoAt);
  const paymentDayMismatch = effectiveChargeDay != null && row.paymentDay && effectiveChargeDay !== Number(row.paymentDay);
  const productLabel = String(row.productName || row.planName || "Producto").trim() || "Producto";
  const initials = productLabel.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "PR";

  const showCharge = isAutoDebit && !isInactive && Boolean(row.canManualCharge);
  const showMarkPaid = !isInactive && !alreadyPaid && Boolean(row.canManualMarkPaid);
  const showUnmark = alreadyPaid && Boolean(row.canManualUnmarkPaid);
  const showPaymentLink = !isInactive && !isAutoDebit;
  const showTokenization = isAutoDebit && !isInactive;
  const paymentMethodHref = `/customers/${encodeURIComponent(row.customerId)}/payment-method?returnTo=${encodeURIComponent(detailUrl)}`;
  const tenantIds = Array.isArray(row.tenantIds) ? row.tenantIds.map(String) : [];
  const flash = (() => {
    if (sp.tenantsUpdated === "1") return { tone: "ok" as const, text: "Canales actualizados." };
    if (sp.mergedSubscriptions === "1") return { tone: "ok" as const, text: "Suscripciones duplicadas fusionadas." };
    if (ctx.error) return { tone: "error" as const, text: ctx.error };
    return null;
  })();

  return (
    <PageShell
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>{row.customerName}</span>
          <span className={`pill pill-sm ${pill.cls}`}>{pill.label}</span>
        </span>
      }
      subtitle={`${productLabel} · ${row.cada}`}
      crumbs={[{ label: "Suscripciones", href: listHref }, { label: row.customerName }]}
      backHref={listHref}
      backLabel="Volver a la lista"
      notice={flash}
      width="wide"
      headerActions={
        <>
          <Link className="ghost btn-compact btn-noicon" href={to("edit")}>Editar</Link>
          <Link className="ghost btn-compact btn-noicon btn-red" href={to("delete")}>Eliminar</Link>
        </>
      }
    >
      <nav className="page-shell-tabs" aria-label="Secciones de la suscripción">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={withReturnTo(`/billing/${encodeURIComponent(row.id)}${t.key === "resumen" ? "" : `?tab=${t.key}`}`, listHref)}
            className={`page-shell-tab${tab === t.key ? " is-active" : ""}`}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "resumen" ? (
        <>
          <div className="billing-detail-grid">
            <PageSection title="Contacto">
              <dl className="page-shell-dl">
                <div><dt>Nombre</dt><dd>{row.customerName}</dd></div>
                <div><dt>Email</dt><dd>{row.customerEmail || "—"}</dd></div>
                <div><dt>Teléfono</dt><dd>{row.customerPhone || "—"}</dd></div>
                <div><dt>Identificación</dt><dd>{row.identificacion || "—"}</dd></div>
                <div><dt>Canal</dt><dd>{row.tenantName || "—"}</dd></div>
                <div>
                  <dt>Tarjeta</dt>
                  <dd>{row.customerTokenized ? <span className="pill pill-sm pill-ok">Guardada</span> : <span className="pill pill-sm pill-warn">Sin tarjeta</span>}</dd>
                </div>
              </dl>
              <div>
                <Link className="ghost btn-compact btn-noicon" href={withReturnTo(`/customers/${encodeURIComponent(row.customerId)}`, detailUrl)}>
                  Abrir este contacto
                </Link>
              </div>
            </PageSection>

            <PageSection title="Producto">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div className="billing-product-thumb" style={{ width: 48, height: 48, minWidth: 48 }}>
                  {row.planImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.planImageUrl} alt={productLabel} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
                  ) : (
                    <span className="billing-product-fallback" style={{ fontSize: 14 }}>{initials}</span>
                  )}
                </div>
                <div>
                  <div className="billing-value" style={{ fontSize: 14 }}>{productLabel}</div>
                  <div className="field-hint">{row.tipoTx || "—"} · {row.cada}</div>
                </div>
              </div>
              <div>
                <Link className="ghost btn-compact btn-noicon" href={to("change-product")}>Cambiar producto</Link>
              </div>
            </PageSection>

            <PageSection title="Fecha de cobro">
              <dl className="page-shell-dl">
                <div><dt>Próximo cobro</dt><dd>{formatCivilDate(row.vencimientoAt)}</dd></div>
                {row.periodoInicioAt && row.periodoFinAt ? (
                  <div><dt>Ciclo actual</dt><dd>{formatCivilDate(row.periodoInicioAt)} → {formatCivilDate(row.periodoFinAt)}</dd></div>
                ) : null}
                <div><dt>Inicio de ciclo</dt><dd>Día {row.cycleStartDay}</dd></div>
                <div>
                  <dt>Día de cobro</dt>
                  <dd>
                    {effectiveChargeDay != null ? `Día ${effectiveChargeDay}` : "—"}
                    {paymentDayMismatch ? <span className="field-hint"> · configurado: día {row.paymentDay}</span> : null}
                  </dd>
                </div>
                <div><dt>Días de gracia</dt><dd>{row.graceDays} días</dd></div>
              </dl>
            </PageSection>

            <PageSection title="Totales" description="Incluye base + flete según configuración del plan.">
              <div className="billing-value" style={{ fontSize: 20, color: "var(--primary)" }}>{money(row.totalInCents, row.moneda)}</div>
              <div className="field-hint">{row.cada}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="billing-cost-chip">Base {money(row.valorBaseInCents, row.moneda)}</span>
                <span className="billing-cost-chip">
                  {row.currentShippingInCents > 0 ? `Flete ${money(row.currentShippingInCents, row.moneda)}` : "Flete gratis"}
                </span>
              </div>
            </PageSection>
          </div>

          <PageSection title="Acciones">
            <div className="billing-detail-actions">
              {showCharge ? <Link className="primary btn-compact btn-noicon" href={to("charge")}>Cobrar ahora</Link> : null}
              {showMarkPaid ? <Link className="ghost btn-compact btn-noicon btn-green" href={to("mark-paid")}>Marcar pagada</Link> : null}
              {showUnmark ? <Link className="ghost btn-compact btn-noicon btn-red" href={to("unmark-paid")}>Desmarcar cobro</Link> : null}
              {showPaymentLink ? <Link className="ghost btn-compact btn-noicon" href={to("payment-link")}>Enviar link de pago</Link> : null}
              {showTokenization ? <Link className="ghost btn-compact btn-noicon" href={to("tokenization")}>Enviar tokenización</Link> : null}
              {showTokenization ? (
                <a className="ghost btn-compact btn-noicon" href={paymentMethodHref}>
                  {row.customerTokenized ? "Actualizar tarjeta" : "Guardar tarjeta"}
                </a>
              ) : null}
              {isDuplicateKeep && duplicateCount > 1 ? (
                <Link className="ghost btn-compact btn-noicon btn-amber" href={to("merge")}>Fusionar duplicadas ({duplicateCount - 1})</Link>
              ) : null}
              {isSuspended ? (
                <form action={resumeSubscription}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="subscriptionId" value={row.id} />
                  {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
                  <input type="hidden" name="returnTo" value={detailUrl} />
                  <button className="ghost btn-compact btn-green btn-noicon" type="submit">Reanudar</button>
                </form>
              ) : null}
              {isReactivatable ? (
                <form action={activateSubscription}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="subscriptionId" value={row.id} />
                  {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}
                  <input type="hidden" name="returnTo" value={detailUrl} />
                  <button className="ghost btn-compact btn-green btn-noicon" type="submit">Reactivar</button>
                </form>
              ) : null}
            </div>
          </PageSection>
        </>
      ) : null}

      {tab === "ciclos" ? (
        <BillingCyclesPanel subscriptionId={row.id} csrfToken={csrfToken} returnTo={detailUrl} tenantId={row.tenantId || undefined} />
      ) : null}

      {tab === "pagos" ? (
        <PageSection title="Historial de pagos">
          <PaymentHistoryPanel subscriptionId={row.id} tenantId={row.tenantId || undefined} />
        </PageSection>
      ) : null}

      {tab === "canales" ? (
        <form action={updateSubscriptionTenants} className="page-shell-body">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="subscriptionId" value={row.id} />
          <input type="hidden" name="scopeTenantId" value={row.tenantId || ""} />
          <input type="hidden" name="primaryTenantId" value={row.tenantId || ""} />
          <input type="hidden" name="returnTo" value={withReturnTo(`/billing/${encodeURIComponent(row.id)}?tab=canales`, listHref)} />
          <PageSection title="Canales de la suscripción" description="Elige en qué canales de venta aparece esta suscripción.">
            <div className="billing-detail-channels">
              {tenants.map((tenant) => {
                const id = String(tenant.id || "");
                return (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" name="tenantIds" value={id} defaultChecked={tenantIds.includes(id)} />
                    <span>{tenant.name}</span>
                  </label>
                );
              })}
            </div>
          </PageSection>
          <FormActions cancelHref={withReturnTo(`/billing/${encodeURIComponent(row.id)}`, listHref)}>
            <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
              Guardar canales
            </PendingButton>
          </FormActions>
        </form>
      ) : null}
    </PageShell>
  );
}
