import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { withReturnTo } from "../../../lib/returnTo";
import { chargeSubscriptionNow } from "../../actions";
import { ChargeStatusPanel } from "../../ChargeStatusPanel";
import { loadSubscriptionPage, money } from "../../subscriptionPage";
import { formatCivilDate } from "../../civilDate";

export const dynamic = "force-dynamic";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/**
 * Cobro manual por débito automático.
 *
 * Una sola página para todo el recorrido: confirmar → "procesando" (consulta el
 * estado en Wompi) → resultado, con reintento. La acción vuelve a esta misma
 * página con `chargeStatus`, por eso `chargePageHref` es el `returnTo` del formulario.
 */
export default async function ChargePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await loadSubscriptionPage(params, searchParams);
  const { row, csrfToken, returnTo, sp } = ctx;
  const chargePageHref = withReturnTo(`/billing/${encodeURIComponent(row.id)}/charge`, returnTo);
  const chargeStatus = str(sp.chargeStatus);

  const header = {
    title: "Cobrar suscripción",
    subtitle: ctx.subtitle,
    crumbs: ctx.crumbs("Cobrar"),
    backHref: returnTo
  };

  if (chargeStatus) {
    return (
      <PageShell {...header} title="Resultado del cobro" notice={ctx.error ? { tone: "error", text: ctx.error } : null}>
        <ChargeStatusPanel
          initialStatus={chargeStatus === "processing" ? "processing" : chargeStatus === "ok" ? "ok" : "fail"}
          paymentId={str(sp.paymentId)}
          chargeError={str(sp.chargeError)}
          chargeErrorDetails={str(sp.chargeErrorDetails)}
          returnTo={chargePageHref}
          backHref={returnTo}
          subscriptionId={row.id}
          tenantId={row.tenantId || undefined}
          csrfToken={csrfToken}
          retryAction={chargeSubscriptionNow}
        />
      </PageShell>
    );
  }

  const disabled = row.manualChargeEnabled === false;
  const warnNotDue = !row.chargeDue;
  const warnAlreadyPaid = Boolean(row.lastPaidInCurrentPeriod);
  const needsAck = warnNotDue || warnAlreadyPaid;

  return (
    <PageShell {...header} notice={ctx.error ? { tone: "error", text: ctx.error } : null}>
      {disabled ? (
        <PageSection title="Cobro manual deshabilitado">
          <p>El cobro manual está desactivado en la configuración. Para habilitarlo:</p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>Ve a <strong>Configuración</strong></li>
            <li>Abre la pestaña <strong>Cobros</strong></li>
            <li>Activa la opción <strong>&ldquo;Permitir cobro manual&rdquo;</strong></li>
          </ol>
          <div>
            <a className="primary btn-compact btn-noicon" href="/settings?tab=cobros">Ir a Configuración</a>
          </div>
        </PageSection>
      ) : (
        <form action={chargeSubscriptionNow} className="page-shell-body">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="subscriptionId" value={row.id} />
          <input type="hidden" name="returnTo" value={chargePageHref} />
          {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}

          <PageSection title="Se cobrará a la tarjeta registrada" description="Débito automático: el cobro se envía a Wompi y se confirma por webhook.">
            <dl className="page-shell-dl">
              <div><dt>Cliente</dt><dd>{row.customerName}</dd></div>
              <div><dt>Producto</dt><dd>{row.productName || row.planName}</dd></div>
              <div><dt>Monto</dt><dd><strong>{money(row.totalInCents, row.moneda)}</strong> · {row.cada}</dd></div>
              <div><dt>Ciclo</dt><dd>{row.cycleNumber != null ? `#${row.cycleNumber}` : "—"} · vence {formatCivilDate(row.vencimientoAt)}</dd></div>
              <div><dt>Tarjeta</dt><dd>{row.customerTokenized ? "Registrada" : "Sin tarjeta registrada"}</dd></div>
            </dl>
          </PageSection>

          {!row.customerTokenized ? (
            <div className="field-hint ui-alert-warn">
              El cliente no tiene tarjeta registrada: el cobro puede fallar. Envíale primero el link de tokenización.
            </div>
          ) : null}

          {needsAck ? (
            <PageSection title="Antes de cobrar">
              {warnAlreadyPaid ? <p className="ui-alert-warn" style={{ margin: 0 }}>Esta suscripción ya tiene un pago aprobado en el periodo actual.</p> : null}
              {warnNotDue ? <p className="ui-alert-warn" style={{ margin: 0 }}>La fecha de corte aún no se ha cumplido.</p> : null}
              <label className="field" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" name="acknowledgeCharge" value="1" required />
                <span>Entiendo lo anterior y quiero cobrar igualmente.</span>
              </label>
            </PageSection>
          ) : null}

          <FormActions cancelHref={returnTo}>
            <PendingButton className="primary btn-compact btn-pay" type="submit" pendingText="Cobrando...">
              Cobrar ahora
            </PendingButton>
          </FormActions>
        </form>
      )}
    </PageShell>
  );
}
