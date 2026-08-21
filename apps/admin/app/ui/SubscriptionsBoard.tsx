import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import type {
  ModeSummary,
  SubscriptionBoardRow,
  SubscriptionsBoard
} from "../admin/_services/subscriptionsBoard";
import { SubscriptionsBoardFilters, type BoardFilters } from "./SubscriptionsBoardFilters";

const TZ = "America/Bogota";

function money(cents: number) {
  return `$${Math.round((cents || 0) / 100).toLocaleString("es-CO")}`;
}

function pct(part: number, total: number) {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

function shortDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(d);
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

const STATE_TILES = [
  { id: "AL_DIA", label: "Al día", tone: "ok", count: "current", money: "currentInCents" },
  { id: "EN_GRACIA", label: "En gracia", tone: "warn", count: "inGrace", money: "inGraceInCents" },
  { id: "EN_MORA", label: "En mora", tone: "bad", count: "overdue", money: "overdueInCents" }
] as const;

const NEXT_CHARGE_HINT: Record<string, string> = {
  RETRY: "reintento agendado",
  DUE: "fecha de corte"
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

function ModeBlock({
  summary,
  rows,
  openId,
  detail,
  detailHref
}: {
  summary: ModeSummary;
  rows: SubscriptionBoardRow[];
  openId: string | null;
  detail: ReactNode;
  detailHref: (subscriptionId: string) => string;
}) {
  const mine = rows.filter((r) => r.mode === summary.mode);
  if (!mine.length) return null;
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
          {summary.unscheduled ? (
            <span className="is-bad"><strong>{summary.unscheduled}</strong> sin cobro programado</span>
          ) : null}
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
              <th>Estado del ciclo</th>
              <th>Próximo cobro</th>
              <th>Aviso</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mine.map((row) => {
              const d = DELINQUENCY[row.delinquency];
              const isOpen = openId === row.subscriptionId;
              return (
                <Fragment key={row.subscriptionId}>
                <tr className={isOpen ? "is-open" : undefined}>
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
                  <td>
                    <span className="sb-cycle-n">{row.cycleNumber != null ? `#${row.cycleNumber}` : "—"}</span>
                    {row.cyclePaid ? (
                      <span className="sb-sub-flag is-ok">pagado {shortDate(row.cyclePaidAt)}</span>
                    ) : (
                      <span className="sb-sub-flag is-warn">sin pagar</span>
                    )}
                    {row.chargeFailure ? (
                      <span className="sb-sub-flag is-bad" title={row.chargeFailure.reason}>
                        cobro rechazado
                      </span>
                    ) : null}
                  </td>
                  <td>{shortDate(row.cycleDueAt)}</td>
                  <td>
                    <span className={`pill ${d.cls}`}>{d.label}</span>
                    {row.delinquency === "EN_MORA" && row.daysPastDue > 0 ? (
                      <span className="sb-days">{row.daysPastDue}d</span>
                    ) : null}
                  </td>
                  <td>
                    {row.cyclePaid ? (
                      <span className="muted">Ciclo cobrado</span>
                    ) : row.nextCharge ? (
                      <>
                        <span>{shortDateTime(row.nextCharge.at)}</span>
                        <span className="sb-sub-flag">{NEXT_CHARGE_HINT[row.nextCharge.kind]}</span>
                      </>
                    ) : (
                      <span className="sb-bad">Sin cobro programado</span>
                    )}
                  </td>
                  <td>
                    {row.notice ? (
                      row.notice.status === "SENT" ? (
                        <span className="sb-ok" title={row.notice.content || undefined}>
                          {row.notice.kind} enviado
                        </span>
                      ) : row.notice.status === "FAILED" ? (
                        <>
                          <span className="sb-bad">{row.notice.kind} falló</span>
                          <span className="sb-sub-flag is-bad">{row.notice.reason}</span>
                        </>
                      ) : (
                        <span className="sb-warn">{row.notice.kind} en cola</span>
                      )
                    ) : (
                      <span className="muted">Sin aviso</span>
                    )}
                  </td>
                  <td className="sb-row-more">
                    <Link href={detailHref(row.subscriptionId)} prefetch={false} className="ghost btn-compact btn-noicon">
                      {isOpen ? "Ocultar" : "Ver"}
                    </Link>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="sb-detail-row">
                    <td colSpan={9}>{detail}</td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SubscriptionsBoardPanel({
  board,
  filtered,
  filters,
  baseParams,
  exportHref,
  openId = null,
  detail = null,
  detailHref = () => "/"
}: {
  board: SubscriptionsBoard;
  filtered: SubscriptionsBoard;
  filters: BoardFilters;
  baseParams: URLSearchParams;
  exportHref: string;
  /** Suscripción cuyo detalle está abierto, si hay alguna. */
  openId?: string | null;
  detail?: ReactNode;
  detailHref?: (subscriptionId: string) => string;
}) {
  if (!board.rows.length) {
    return <p className="muted">No hay suscripciones activas.</p>;
  }

  // Los totales salen del recorte visible: si se filtra por mora, la cabecera
  // habla de los morosos y no de una cartera que no se está viendo.
  const t = filtered.totals;

  return (
    <div className="sb">
      <SubscriptionsBoardFilters
        filters={filters}
        base={baseParams}
        exportHref={exportHref}
        shown={filtered.rows.length}
        total={board.rows.length}
      />

      {!filtered.rows.length ? (
        <p className="muted">Ninguna suscripción coincide con el filtro.</p>
      ) : (
        <>
          {/* Cada tile es el atajo a su lista: un clic y quedan solo esos clientes. */}
          <p className="sb-scope muted">
        Ciclo vigente de cada suscripción: lo que hay que cobrar ahora.
      </p>

      <div className="sb-states">
            {STATE_TILES.map((tile) => {
              const params = new URLSearchParams(baseParams);
              if (filters.state === tile.id) params.delete("state");
              else params.set("state", tile.id);
              params.delete("open");
              return (
                <Link
                  key={tile.id}
                  href={`/?${params.toString()}`}
                  prefetch={false}
                  className={`sb-state is-${tile.tone}${filters.state === tile.id ? " is-active" : ""}`}
                >
                  <span className="sb-state-n">{t[tile.count]}</span>
                  <span className="sb-state-l">{tile.label}</span>
                  <span className="sb-state-m">{money(t[tile.money])}</span>
                </Link>
              );
            })}
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
              detail={[
                "sin avisar",
                t.withoutCard ? `${t.withoutCard} sin tarjeta` : "",
                t.unscheduled ? `${t.unscheduled} sin cobro programado` : ""
              ]
                .filter(Boolean)
                .join(" · ")}
              tone={t.notNotified || t.unscheduled ? "warn" : undefined}
            />
          </div>

          {filtered.byMode.map((summary) => (
            <ModeBlock
              key={summary.mode}
              summary={summary}
              rows={filtered.rows}
              openId={openId}
              detail={detail}
              detailHref={detailHref}
            />
          ))}
        </>
      )}
    </div>
  );
}
