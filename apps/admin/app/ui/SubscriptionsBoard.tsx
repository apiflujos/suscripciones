import type {
  ModeSummary,
  SubscriptionBoardRow,
  SubscriptionsBoard
} from "../admin/_services/subscriptionsBoard";

const TZ = "America/Bogota";

function money(cents: number) {
  return `$${Math.round((cents || 0) / 100).toLocaleString("es-CO")}`;
}

function pct(part: number, total: number) {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

function shortDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "2-digit", month: "short" }).format(d);
}

const MODE_LABEL: Record<string, string> = {
  AUTO_DEBIT: "Débito automático",
  AUTO_LINK: "Link de pago automático",
  MANUAL_LINK: "Cobro manual"
};

const MODE_HINT: Record<string, string> = {
  AUTO_DEBIT: "Se cobra la tarjeta guardada en el corte.",
  AUTO_LINK: "Se genera el link y se envía por WhatsApp.",
  MANUAL_LINK: "El sistema no los contacta: hay que enviarles el link a mano."
};

const DELINQUENCY = {
  AL_DIA: { label: "Al día", cls: "pill-ok" },
  EN_GRACIA: { label: "En gracia", cls: "pill-warn" },
  EN_MORA: { label: "En mora", cls: "pill-bad" }
} as const;

/** Un número con su significado al lado. Sin tarjetas de relleno. */
function Kpi({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "bad" | "warn";
}) {
  return (
    <div className={`sb-kpi${tone ? ` is-${tone}` : ""}`}>
      <div className="sb-kpi-label">{label}</div>
      <div className="sb-kpi-value">{value}</div>
      {detail ? <div className="sb-kpi-detail">{detail}</div> : null}
    </div>
  );
}

function ModeBlock({ summary, rows }: { summary: ModeSummary; rows: SubscriptionBoardRow[] }) {
  const mine = rows.filter((r) => r.mode === summary.mode);
  return (
    <section className="sb-mode">
      <header className="sb-mode-head">
        <div>
          <h3>{MODE_LABEL[summary.mode]}</h3>
          <p className="muted">{MODE_HINT[summary.mode]}</p>
        </div>
        <div className="sb-mode-stats">
          <span><strong>{summary.subscriptions}</strong> suscripciones</span>
          <span><strong>{money(summary.expectedInCents)}</strong> esperado</span>
          <span className="is-ok">
            <strong>{money(summary.collectedInCents)}</strong> cobrado ({pct(summary.paid, summary.subscriptions)})
          </span>
          <span className="is-pending"><strong>{money(summary.pendingInCents)}</strong> pendiente</span>
          <span className="is-ok"><strong>{summary.current}</strong> al día</span>
          {summary.inGrace ? <span className="is-warn"><strong>{summary.inGrace}</strong> en gracia</span> : null}
          {summary.overdue ? <span className="is-bad"><strong>{summary.overdue}</strong> en mora</span> : null}
          {summary.notNotified ? <span className="is-warn"><strong>{summary.notNotified}</strong> sin avisar</span> : null}
          {summary.withoutCard ? <span className="is-warn"><strong>{summary.withoutCard}</strong> sin tarjeta</span> : null}
        </div>
      </header>

      <div className="sb-table-wrap">
        <table className="sb-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Plan</th>
              <th className="sb-num">Monto</th>
              <th>Ciclo</th>
              <th>Vence</th>
              <th>Cobranza</th>
              <th>Pago</th>
              <th>Aviso</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((row) => {
              const d = DELINQUENCY[row.delinquency];
              return (
                <tr key={row.subscriptionId}>
                  <td>
                    <span className="sb-name">{row.customerName}</span>
                    {row.subscriptionStatus === "PAST_DUE" ? (
                      <span className="sb-sub-flag">suscripción en mora</span>
                    ) : null}
                    {row.mode === "AUTO_DEBIT" && !row.hasCard ? (
                      <span className="sb-sub-flag is-warn">sin tarjeta</span>
                    ) : null}
                  </td>
                  <td className="muted">{row.planName}</td>
                  <td className="sb-num">{money(row.amountInCents)}</td>
                  <td className="sb-num">{row.cycleNumber ?? "—"}</td>
                  <td>{shortDate(row.cycleDueAt)}</td>
                  <td>
                    <span className={`pill ${d.cls}`}>{d.label}</span>
                    {row.delinquency === "EN_MORA" && row.daysPastDue > 0 ? (
                      <span className="sb-days">{row.daysPastDue}d</span>
                    ) : null}
                  </td>
                  <td>
                    {row.lastPaymentStatus === "APPROVED" ? (
                      <span className="sb-ok">Pagado {shortDate(row.lastPaymentAt)}</span>
                    ) : row.lastPaymentStatus === "DECLINED" ? (
                      <span className="sb-bad">Rechazado</span>
                    ) : row.lastPaymentStatus === "PENDING" ? (
                      <span className="muted">Esperando pago</span>
                    ) : (
                      <span className="muted">Sin intento</span>
                    )}
                  </td>
                  <td>
                    {row.messageDelivered === true ? (
                      <span className="sb-ok">Entregado</span>
                    ) : row.messageDelivered === false ? (
                      <span className="sb-bad" title={row.messageError || undefined}>Falló</span>
                    ) : (
                      <span className="sb-warn">Sin enviar</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SubscriptionsBoardPanel({ board }: { board: SubscriptionsBoard }) {
  const t = board.totals;
  if (!t.subscriptions) {
    return <p className="muted">No hay suscripciones activas.</p>;
  }

  return (
    <div className="sb">
      <div className="sb-states">
        <div className="sb-state is-ok">
          <span className="sb-state-n">{t.current}</span>
          <span className="sb-state-l">Al día</span>
          <span className="sb-state-m">{money(t.currentInCents)}</span>
        </div>
        <div className="sb-state is-warn">
          <span className="sb-state-n">{t.inGrace}</span>
          <span className="sb-state-l">En gracia</span>
          <span className="sb-state-m">{money(t.inGraceInCents)}</span>
        </div>
        <div className="sb-state is-bad">
          <span className="sb-state-n">{t.overdue}</span>
          <span className="sb-state-l">En mora</span>
          <span className="sb-state-m">{money(t.overdueInCents)}</span>
        </div>
      </div>

      <div className="sb-kpis">
        <Kpi
          label="Cartera activa"
          value={`${t.subscriptions}`}
          detail={`${money(t.mrrInCents)} por ciclo`}
        />
        <Kpi
          label="Cobrado del ciclo"
          value={money(t.collectedInCents)}
          detail={`de ${money(t.expectedInCents)} · ${pct(t.collectedInCents, t.expectedInCents)}`}
        />
        <Kpi
          label="Pendiente de cobro"
          value={money(t.pendingInCents)}
          detail={t.overdue ? `${t.overdue} en mora · ${money(t.overdueInCents)}` : "nadie en mora"}
          tone={t.overdue ? "bad" : undefined}
        />
        <Kpi
          label="Riesgo operativo"
          value={`${t.notNotified}`}
          detail={`sin avisar${t.withoutCard ? ` · ${t.withoutCard} sin tarjeta` : ""}`}
          tone={t.notNotified ? "warn" : undefined}
        />
      </div>

      {board.byMode.map((summary) => (
        <ModeBlock key={summary.mode} summary={summary} rows={board.rows} />
      ))}
    </div>
  );
}
