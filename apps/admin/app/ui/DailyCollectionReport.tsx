import type { CollectionRow, DailyCollectionReport } from "../admin/_services/dailyCollectionReport";

function money(cents: number) {
  return `$ ${Math.round((cents || 0) / 100).toLocaleString("es-CO")}`;
}

function paymentPill(row: CollectionRow) {
  const status = String(row.paymentStatus || "").toUpperCase();
  if (status === "APPROVED") return { label: "Cobrado", cls: "pill-ok" };
  if (status === "DECLINED") return { label: "Rechazado", cls: "pill-bad" };
  if (status === "ERROR") return { label: "Error", cls: "pill-bad" };
  if (status === "VOIDED") return { label: "Anulado", cls: "pill-warn" };
  if (status === "PENDING") return { label: "Pendiente de pago", cls: "pill-warn" };
  return { label: "Sin intento", cls: "pill-warn" };
}

const MESSAGE_LABEL: Record<string, string> = {
  PAYMENT_LINK: "Link de pago",
  PAYMENT_CONFIRMED: "Pago confirmado",
  PAYMENT_FAILED: "Pago rechazado",
  EXPIRY_WARNING: "Aviso de vencimiento"
};

function MessageBlock({ message }: { message: CollectionRow["messages"][number] }) {
  const sent = message.status === "SENT";
  return (
    <div className="collection-report-message">
      <div className="collection-report-message-head">
        <span className={`pill ${sent ? "pill-ok" : "pill-bad"}`}>
          {sent ? "Enviado" : "Falló"}
        </span>
        <span className="muted">{MESSAGE_LABEL[message.type] || message.type}</span>
        {message.to ? <span className="muted">· {message.to}</span> : null}
      </div>
      {message.content ? (
        <pre className="collection-report-message-body">{message.content}</pre>
      ) : (
        <p className="muted">Sin contenido guardado.</p>
      )}
      {message.errorMessage ? (
        <p className="collection-report-message-error">{message.errorMessage}</p>
      ) : null}
    </div>
  );
}

function Row({ row }: { row: CollectionRow }) {
  const pill = paymentPill(row);
  const delivered = row.messages.filter((m) => m.status === "SENT").length;
  return (
    <li className="collection-report-row">
      <div className="collection-report-row-head">
        <div>
          <strong>{row.customerName}</strong>
          <span className="muted"> · {row.planName} · ciclo {row.cycleNumber}</span>
        </div>
        <div className="collection-report-row-right">
          <span className="collection-report-amount">{money(row.amountInCents)}</span>
          <span className={`pill ${pill.cls}`}>{pill.label}</span>
        </div>
      </div>

      {row.wompiTransactionId ? (
        <p className="muted collection-report-tx">Transacción {row.wompiTransactionId}</p>
      ) : null}

      {row.messages.length === 0 ? (
        <p className="collection-report-nomsg">No se le envió ningún mensaje.</p>
      ) : (
        <>
          <p className="muted">
            {delivered} de {row.messages.length} mensajes entregados
          </p>
          {row.messages.map((message, index) => (
            <MessageBlock key={`${row.subscriptionId}-${index}`} message={message} />
          ))}
        </>
      )}
    </li>
  );
}

function Section({ title, hint, rows }: { title: string; hint: string; rows: CollectionRow[] }) {
  const cobrados = rows.filter((r) => String(r.paymentStatus).toUpperCase() === "APPROVED").length;
  const pendientes = rows.length - cobrados;
  const sinMensaje = rows.filter((r) => !r.messages.some((m) => m.status === "SENT")).length;

  return (
    <section className="collection-report-section">
      <header className="collection-report-section-head">
        <h3>{title}</h3>
        <p className="muted">{hint}</p>
        <p className="collection-report-tally">
          {rows.length} suscripciones · {cobrados} cobradas · {pendientes} pendientes ·{" "}
          <strong>{sinMensaje} sin avisar</strong>
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="muted">Nada pendiente en este grupo.</p>
      ) : (
        <ul className="collection-report-list">
          {rows.map((row) => (
            <Row key={`${row.subscriptionId}-${row.cycleNumber}`} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function DailyCollectionReportPanel({ report }: { report: DailyCollectionReport }) {
  const total = report.autoDebit.length + report.paymentLink.length + report.manual.length;
  if (!total) {
    return (
      <section className="collection-report">
        <h2>Reporte de cobros</h2>
        <p className="muted">No hay ciclos vencidos sin pagar.</p>
      </section>
    );
  }

  return (
    <section className="collection-report">
      <h2>Reporte de cobros</h2>
      <p className="muted">
        Ciclos vencidos y sin pagar, con el resultado del cobro y el mensaje que se le envió al cliente.
      </p>

      <Section
        title="Débito automático"
        hint="Se cobra la tarjeta guardada. Si el cliente no tiene tarjeta, cae a link de pago."
        rows={report.autoDebit}
      />
      <Section
        title="Links de pago"
        hint="Se genera el link y se envía por WhatsApp. El cliente paga por su cuenta."
        rows={report.paymentLink}
      />
      <Section
        title="Cobro manual"
        hint="El sistema no los contacta solo: hay que enviarles el link a mano."
        rows={report.manual}
      />
    </section>
  );
}
