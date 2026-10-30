import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { markSubscriptionPaidManual } from "../../actions";
import { loadSubscriptionPage, money } from "../../subscriptionPage";

export const dynamic = "force-dynamic";

/** Marcar una suscripción como pagada a mano (transferencia, Bre-B, efectivo). */
export default async function MarkPaidPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await loadSubscriptionPage(params, searchParams);
  const { row, csrfToken, returnTo } = ctx;
  const disabled = row.manualMarkPaidEnabled === false;
  const alreadyPaid = Boolean(row.lastPaidInCurrentPeriod);

  return (
    <PageShell
      title="Marcar como pagada"
      subtitle={ctx.subtitle}
      crumbs={ctx.crumbs("Marcar pagada")}
      backHref={returnTo}
      notice={ctx.error ? { tone: "error", text: ctx.error } : null}
    >
      {disabled ? (
        <PageSection title="Marcado manual deshabilitado">
          <p>El marcado manual de pagos está desactivado en la configuración. Para habilitarlo:</p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>Ve a <strong>Configuración</strong></li>
            <li>Abre la pestaña <strong>Cobros</strong></li>
            <li>Activa la opción <strong>&ldquo;Permitir marcado manual de pagos&rdquo;</strong></li>
          </ol>
          <div>
            <a className="primary btn-compact btn-noicon" href="/settings?tab=cobros">Ir a Configuración</a>
          </div>
        </PageSection>
      ) : (
        <form action={markSubscriptionPaidManual} className="page-shell-body">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="subscriptionId" value={row.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}

          <PageSection title="Pago recibido" description={`${money(row.totalInCents, row.moneda)} · ${row.cada}`}>
            <div className="field">
              <label htmlFor="manualMethod">¿Cómo se pagó esta suscripción?</label>
              <select id="manualMethod" className="select" name="manualMethod" defaultValue="TRANSFERENCIA" required>
                <option value="TRANSFERENCIA">Transferencia</option>
                <option value="BREB">Bre-B</option>
                <option value="EFECTIVO">Efectivo</option>
              </select>
            </div>
            {alreadyPaid ? (
              <label className="field ui-alert-warn" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" name="acknowledgeAlreadyPaid" value="1" required />
                <span>
                  Esta suscripción ya tiene un pago aprobado en el periodo actual. Entiendo que marcarla pagada de nuevo
                  registra un segundo pago.
                </span>
              </label>
            ) : null}
          </PageSection>

          <FormActions cancelHref={returnTo}>
            <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
              Confirmar pago
            </PendingButton>
          </FormActions>
        </form>
      )}
    </PageShell>
  );
}
