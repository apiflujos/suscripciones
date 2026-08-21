import Link from "next/link";
import type { SubscriptionsBoard } from "../admin/_services/subscriptionsBoard";

function money(cents: number) {
  return `$${Math.round((cents || 0) / 100).toLocaleString("es-CO")}`;
}

function pct(part: number, total: number) {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

const MODE_LABEL: Record<string, string> = {
  AUTO_DEBIT: "Débito automático",
  AUTO_LINK: "Link de pago automático",
  MANUAL_LINK: "Cobro manual"
};

const STATES = [
  { id: "AL_DIA", label: "Al día", tone: "ok", count: "current", money: "currentInCents" },
  { id: "EN_GRACIA", label: "En gracia", tone: "warn", count: "inGrace", money: "inGraceInCents" },
  { id: "EN_MORA", label: "En mora", tone: "bad", count: "overdue", money: "overdueInCents" }
] as const;

/**
 * El estado de la cobranza en un bloque: cuánto entró, cuánto falta y qué está
 * en riesgo. Nada de listas —para eso está el módulo de suscripciones—, solo
 * la foto del ciclo vigente y la puerta para ir a operarlo.
 */
export function CollectionSummary({ board, listHref }: { board: SubscriptionsBoard; listHref: string }) {
  const t = board.totals;

  if (!t.subscriptions) {
    return (
      <details className="cs" open>
        <summary className="cs-head">
          <span className="cs-title">Cobranza del ciclo vigente</span>
        </summary>
        <p className="muted cs-empty">No hay suscripciones activas.</p>
      </details>
    );
  }

  const riesgo = [
    t.notNotified ? `${t.notNotified} sin avisar` : "",
    t.withoutCard ? `${t.withoutCard} sin tarjeta` : "",
    t.unscheduled ? `${t.unscheduled} sin cobro programado` : ""
  ].filter(Boolean);

  return (
    <details className="cs" open>
      <summary className="cs-head">
        <span className="cs-title">Cobranza del ciclo vigente</span>
        <span className="cs-headline">
          <strong>{money(t.collectedInCents)}</strong> de {money(t.expectedInCents)} ({pct(t.collectedInCents, t.expectedInCents)})
        </span>
      </summary>

      <div className="cs-body">
        <div className="cs-states">
          {STATES.map((s) => (
            <Link key={s.id} href={`${listHref}?state=${s.id}`} prefetch={false} className={`cs-state is-${s.tone}`}>
              <span className="cs-state-n">{t[s.count]}</span>
              <span className="cs-state-l">{s.label}</span>
              <span className="cs-state-m">{money(t[s.money])}</span>
            </Link>
          ))}
        </div>

        <p className="cs-line">
          Pendiente de cobro <strong>{money(t.pendingInCents)}</strong> sobre {t.subscriptions} suscripciones activas.
          {riesgo.length ? <span className="cs-risk"> Atención: {riesgo.join(" · ")}.</span> : null}
        </p>

        {board.byMode.length > 1 ? (
          <details className="cs-modes">
            <summary>Por modo de cobro</summary>
            <ul>
              {board.byMode.map((m) => (
                <li key={m.mode}>
                  <span className="cs-mode-name">{MODE_LABEL[m.mode] ?? m.mode}</span>
                  <span className="muted">
                    {m.subscriptions} · {money(m.collectedInCents)} cobrado de {money(m.expectedInCents)}
                    {m.overdue ? ` · ${m.overdue} en mora` : ""}
                    {m.unscheduled ? ` · ${m.unscheduled} sin cobro programado` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <Link href={listHref} prefetch={false} className="ghost btn-compact btn-noicon cs-cta">
          Ver y operar en suscripciones
        </Link>
      </div>
    </details>
  );
}
