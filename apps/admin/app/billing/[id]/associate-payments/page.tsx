import Link from "next/link";
import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { associatePaymentsBulk } from "../../../logs/actions";
import { listBulkAssociationCandidates, type BulkCandidate } from "../../../admin/_services/paymentsBulk";
import { loadSubscriptionPage, money } from "../../subscriptionPage";

export const dynamic = "force-dynamic";

const fmtDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "America/Bogota" }).format(new Date(value)) : "—";

const REASONS: Record<BulkCandidate["reason"], string> = {
  same_contact: "Mismo contacto",
  similar_name: "Nombre parecido",
  same_phone: "Mismo teléfono",
  same_email: "Mismo correo",
  search: "Búsqueda"
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || "";

/**
 * Asociar de una vez los pagos sueltos de un contacto a su suscripción.
 *
 * Cuando el pagador escribe otro nombre o correo, el pago queda bajo un contacto
 * nuevo y la suscripción real sigue en mora aunque el cliente sí pagó.
 */
export default async function AssociatePaymentsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await loadSubscriptionPage(params, searchParams);
  const { row, csrfToken, returnTo, sp } = ctx;
  const q = one(sp.q).trim();
  const data = await listBulkAssociationCandidates({ subscriptionId: row.id, q });

  const ok = Number(one(sp.assocOk) || 0);
  const fail = Number(one(sp.assocFail) || 0);
  const why = one(sp.assocErr);
  const all = one(sp.all) === "1";
  const notice = ctx.error
    ? { tone: "error" as const, text: ctx.error }
    : one(sp.assocNone)
      ? { tone: "error" as const, text: "Marca al menos un pago para asociarlo." }
      : ok || fail
      ? {
          tone: fail ? ("error" as const) : ("ok" as const),
          text: `${ok} ${ok === 1 ? "pago asociado" : "pagos asociados"}${fail ? ` · ${fail} sin asociar${why ? `: ${why}` : ""}` : "."}`
        }
      : null;

  const items = data?.items ?? [];
  const here = `/billing/${encodeURIComponent(row.id)}/associate-payments`;
  const allHref = `${here}?${new URLSearchParams({ ...(q ? { q } : {}), all: "1", returnTo }).toString()}`;

  return (
    <PageShell
      title="Asociar pagos sueltos"
      subtitle={ctx.subtitle}
      crumbs={ctx.crumbs("Asociar pagos sueltos")}
      backHref={returnTo}
      notice={notice}
    >
      <PageSection
        title="Buscar pagos"
        description="Se proponen los pagos aprobados sin suscripción de contactos con el mismo nombre, teléfono o correo. Si falta alguno, búscalo por nombre, correo o teléfono."
      >
        <form method="get" action={here} className="page-shell-body" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <input className="input" name="q" defaultValue={q} placeholder="Nombre, correo o teléfono del pagador" style={{ flex: "1 1 240px" }} />
          <button className="ghost btn-compact btn-noicon" type="submit">Buscar</button>
        </form>
      </PageSection>

      <form action={associatePaymentsBulk} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="subscriptionId" value={row.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <PageSection
          title={`Pagos encontrados (${items.length})`}
          description={
            data
              ? `Cada pago se asocia al ciclo que le toca por fecha, del más viejo al más nuevo. Cobro esperado: ${money(data.expectedInCents, data.currency)}. Ciclos abiertos: ${data.openCycles}.`
              : undefined
          }
        >
          {items.length === 0 ? (
            <p style={{ margin: 0 }}>No hay pagos sueltos que parezcan de esta suscripción. Prueba con otra búsqueda.</p>
          ) : (
            <div className="field" style={{ display: "grid", gap: 8 }}>
              {items.map((item) => {
                const assignable = item.cycleNumber != null;
                return (
                  <label
                    // Con la llave dependiente de "todos", las casillas se montan de nuevo al
                    // cambiar de modo; si no, React las reutiliza y ignora el nuevo defaultChecked.
                    key={`${item.paymentId}:${all ? "all" : "auto"}`}
                    style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: 10, alignItems: "start", opacity: assignable ? 1 : 0.65 }}
                  >
                    <input
                      type="checkbox"
                      name="paymentId"
                      value={item.paymentId}
                      defaultChecked={assignable && (item.amountMatches || all)}
                      disabled={!assignable}
                    />
                    <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                      <strong>
                        {fmtDate(item.paidAt)} · {money(item.amountInCents, item.currency)}
                        {item.amountMatches ? " · monto igual al cobro" : ""}
                      </strong>
                      <span className="muted" style={{ overflowWrap: "anywhere" }}>
                        {item.contactName}
                        {item.contactEmail ? ` · ${item.contactEmail}` : ""} · {REASONS[item.reason]}
                      </span>
                      <span className={assignable ? "" : "muted"}>
                        {assignable
                          ? `Caería en el ciclo ${item.cycleNumber} (vence ${fmtDate(item.cycleDueAt)})`
                          : "No encaja en ningún ciclo abierto por fecha"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </PageSection>

        <FormActions cancelHref={returnTo}>
          {items.some((i) => i.cycleNumber != null) && !all ? (
            <Link className="ghost btn-compact btn-noicon" href={allHref}>
              Marcar todos los que encajan
            </Link>
          ) : null}
          <Link className="ghost btn-compact btn-noicon" href="/payments">
            Ver todos los pagos
          </Link>
          <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Asociando..." disabled={items.every((i) => i.cycleNumber == null)}>
            Asociar seleccionados
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
