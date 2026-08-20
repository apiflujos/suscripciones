import type { ScheduledJobRow, ScheduledJobsReport } from "../admin/_services/scheduledJobsReport";

const TZ = "America/Bogota";

function whenLabel(iso: string, now: Date) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { text: "—", overdue: false };

  const fmt = new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const sameDay =
    new Intl.DateTimeFormat("es-CO", { timeZone: TZ, dateStyle: "short" }).format(date) ===
    new Intl.DateTimeFormat("es-CO", { timeZone: TZ, dateStyle: "short" }).format(now);

  const hora = new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);

  return {
    text: sameDay ? `Hoy ${hora}` : fmt.format(date),
    overdue: date.getTime() < now.getTime()
  };
}

function Row({ row, now }: { row: ScheduledJobRow; now: Date }) {
  const when = whenLabel(row.runAt, now);
  const failed = row.status === "FAILED";
  return (
    <li className="jobs-report-row">
      <div className="jobs-report-when">
        <span className={when.overdue && !failed ? "jobs-report-time is-late" : "jobs-report-time"}>
          {when.text}
        </span>
        {when.overdue && !failed ? <span className="muted jobs-report-late-hint">atrasado</span> : null}
      </div>

      <div className="jobs-report-what">
        <strong>{row.label}</strong>
        {row.detail ? <span className="muted"> · {row.detail}</span> : null}
        <div className="jobs-report-who">
          {row.customerName ? row.customerName : <span className="muted">sin cliente asociado</span>}
        </div>
        {failed && row.lastError ? <p className="jobs-report-error">{row.lastError}</p> : null}
      </div>

      <div className="jobs-report-state">
        <span className={`pill ${failed ? "pill-bad" : row.status === "RUNNING" ? "pill-warn" : "pill-ok"}`}>
          {failed ? "Falló" : row.status === "RUNNING" ? "Corriendo" : "Programado"}
        </span>
        {row.attempts > 0 ? (
          <span className="muted jobs-report-attempts">
            {row.attempts}/{row.maxAttempts} intentos
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function ScheduledJobsPanel({ report }: { report: ScheduledJobsReport }) {
  const now = new Date();
  const next = report.nextRunAt ? whenLabel(report.nextRunAt, now) : null;

  return (
    <section className="jobs-report">
      <h2>Procesos programados</h2>
      <p className="muted">
        Qué va a ejecutar el sistema, a qué hora y sobre qué cliente.
      </p>

      <div className="jobs-report-tally">
        <span><strong>{report.pending}</strong> programados</span>
        <span><strong>{report.running}</strong> corriendo</span>
        <span className={report.overdue ? "is-late" : undefined}>
          <strong>{report.overdue}</strong> atrasados
        </span>
        <span className={report.failed ? "is-bad" : undefined}>
          <strong>{report.failed}</strong> fallidos
        </span>
        {next ? <span className="muted">Próximo: {next.text}</span> : null}
      </div>

      {report.rows.length === 0 ? (
        <p className="muted">No hay nada agendado.</p>
      ) : (
        <ul className="jobs-report-list">
          {report.rows.map((row) => (
            <Row key={row.id} row={row} now={now} />
          ))}
        </ul>
      )}

      {report.failedRows.length > 0 ? (
        <>
          <h3 className="jobs-report-subhead">Fallidos recientes</h3>
          <ul className="jobs-report-list">
            {report.failedRows.map((row) => (
              <Row key={row.id} row={row} now={now} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
