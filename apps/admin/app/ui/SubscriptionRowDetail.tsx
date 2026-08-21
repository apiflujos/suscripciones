import Link from "next/link";
import type { SubscriptionTimeline, TimelineEntry } from "../admin/_services/subscriptionTimeline";
import { ManualChargeButton } from "../billing/ManualChargeButton";
import { ManualMarkPaidButton } from "../billing/ManualMarkPaidButton";

const TZ = "America/Bogota";

function money(cents: number) {
  return `$${Math.round((cents || 0) / 100).toLocaleString("es-CO")}`;
}

function stamp(iso: string | null, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(d);
}

const MODE_LABEL: Record<string, string> = {
  AUTO_DEBIT: "Débito automático",
  AUTO_LINK: "Link de pago automático",
  MANUAL_LINK: "Cobro manual"
};

const CYCLE_STATUS_LABEL: Record<string, string> = {
  PAID: "Cobrado",
  PENDING: "Pendiente",
  OVERDUE: "Vencido",
  SKIPPED: "Omitido"
};

function EntryList({ entries, empty, withTime }: { entries: TimelineEntry[]; empty: string; withTime?: boolean }) {
  if (!entries.length) return <p className="muted sb-detail-empty">{empty}</p>;
  return (
    <ol className="sb-timeline">
      {entries.map((entry, i) => (
        <li key={`${entry.title}-${i}`} className={`sb-timeline-item is-${entry.tone}`}>
          <span className="sb-timeline-when">{stamp(entry.at, withTime)}</span>
          <span className="sb-timeline-what">
            <strong>{entry.title}</strong>
            {entry.detail ? <span className="sb-timeline-detail">{entry.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Todo lo de una suscripción en un solo sitio: qué se hizo, qué falta, qué va a
 * ejecutar el sistema y qué se puede ejecutar a mano ahora mismo.
 *
 * Las secciones van siempre en ese orden, y las dos que exigen acción quedan
 * abiertas: lo urgente no debería requerir un clic para aparecer.
 */
export function SubscriptionRowDetail({
  timeline,
  csrfToken,
  returnTo,
  closeHref,
  manualChargeEnabled,
  manualMarkPaidEnabled,
  chargeSubscriptionNow,
  markSubscriptionPaidManual
}: {
  timeline: SubscriptionTimeline;
  csrfToken: string;
  returnTo: string;
  closeHref: string;
  manualChargeEnabled: boolean;
  manualMarkPaidEnabled: boolean;
  chargeSubscriptionNow: (formData: FormData) => void | Promise<void>;
  markSubscriptionPaidManual: (formData: FormData) => void | Promise<void>;
}) {
  const unpaid = timeline.cycles.filter((c) => c.status !== "PAID" && c.status !== "SKIPPED");
  const nextUnpaid = unpaid.length ? unpaid[unpaid.length - 1] : null;
  const alreadyPaid = !unpaid.length;
  const notDue = Boolean(nextUnpaid?.dueAt && new Date(nextUnpaid.dueAt).getTime() > Date.now());
  const isAutoDebit = timeline.mode === "AUTO_DEBIT";

  return (
    <div className="sb-detail">
      <header className="sb-detail-head">
        <div>
          <h4>{timeline.customerName}</h4>
          <p className="muted">
            {timeline.planName} · {money(timeline.amountInCents)} · {MODE_LABEL[timeline.mode] ?? timeline.mode}
            {timeline.customerPhone ? ` · ${timeline.customerPhone}` : ""}
          </p>
        </div>
        <Link href={closeHref} prefetch={false} className="ghost btn-compact">
          Cerrar
        </Link>
      </header>

      <details className="sb-detail-section" open>
        <summary>
          Lo que falta <span className="sb-detail-count">{timeline.pending.length}</span>
        </summary>
        <EntryList entries={timeline.pending} empty="Nada pendiente: está al día." />
      </details>

      <details className="sb-detail-section" open>
        <summary>
          Lo que se va a ejecutar <span className="sb-detail-count">{timeline.scheduled.length}</span>
        </summary>
        <EntryList
          entries={timeline.scheduled}
          empty="No hay nada agendado para esta suscripción."
          withTime
        />
        {timeline.truncated ? (
          <p className="muted sb-detail-empty">Hay más trabajos agendados de los que caben aquí.</p>
        ) : null}
      </details>

      <details className="sb-detail-section">
        <summary>
          Lo que se hizo <span className="sb-detail-count">{timeline.done.length}</span>
        </summary>
        <EntryList entries={timeline.done} empty="Todavía no hay movimientos registrados." />
      </details>

      <details className="sb-detail-section">
        <summary>
          Ciclos de cobro <span className="sb-detail-count">{timeline.cycles.length}</span>
        </summary>
        {timeline.cycles.length ? (
          <div className="sb-table-wrap">
            <table className="sb-table sb-detail-table">
              <thead>
                <tr>
                  <th className="sb-num">Ciclo</th>
                  <th>Período</th>
                  <th>Vence</th>
                  <th>Estado</th>
                  <th>Cobrado</th>
                </tr>
              </thead>
              <tbody>
                {timeline.cycles.map((c) => (
                  <tr key={c.cycleNumber}>
                    <td className="sb-num">{c.cycleNumber}</td>
                    <td className="muted">
                      {stamp(c.periodStartAt)} → {stamp(c.periodEndAt)}
                    </td>
                    <td>{stamp(c.dueAt)}</td>
                    <td>
                      <span className={`pill ${c.status === "PAID" ? "pill-ok" : c.status === "SKIPPED" ? "pill-warn" : "pill-bad"}`}>
                        {CYCLE_STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td>
                      {c.paidAt ? (
                        <span className="sb-ok">
                          {stamp(c.paidAt)}
                          {c.daysLate ? ` · ${c.daysLate}d tarde` : ""}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted sb-detail-empty">Esta suscripción todavía no tiene ciclos generados.</p>
        )}
      </details>

      <details className="sb-detail-section sb-detail-actions" open>
        <summary>Ejecutar ahora</summary>
        <div className="sb-detail-buttons">
          {isAutoDebit ? (
            <ManualChargeButton
              action={chargeSubscriptionNow}
              csrfToken={csrfToken}
              subscriptionId={timeline.subscriptionId}
              tenantId={timeline.tenantId}
              returnTo={returnTo}
              warnNotDue={notDue}
              warnAlreadyPaid={alreadyPaid}
              manualChargeEnabled={manualChargeEnabled && timeline.hasCard}
            />
          ) : null}
          <ManualMarkPaidButton
            action={markSubscriptionPaidManual}
            csrfToken={csrfToken}
            subscriptionId={timeline.subscriptionId}
            tenantId={timeline.tenantId}
            returnTo={returnTo}
            warnAlreadyPaid={alreadyPaid}
            manualMarkPaidEnabled={manualMarkPaidEnabled}
          />
          <Link
            href={`/billing?subscriptionId=${encodeURIComponent(timeline.subscriptionId)}`}
            prefetch={false}
            className="ghost btn-compact btn-noicon"
          >
            Abrir ficha completa
          </Link>
        </div>
        <p className="muted sb-detail-note">
          El link de pago, la solicitud de tarjeta y el cambio de plan viven en la ficha completa.
        </p>
      </details>
    </div>
  );
}
