import Link from "next/link";
import type { SubscriptionsBoard } from "../admin/_services/subscriptionsBoard";

const MODE_LABEL: Record<string, string> = {
  AUTO_DEBIT: "Débito automático",
  AUTO_LINK: "Link automático",
  MANUAL_LINK: "Link manual"
};

const STATE_LABEL: Record<string, string> = {
  AL_DIA: "Al día",
  EN_GRACIA: "En gracia",
  EN_MORA: "En mora"
};

function civilDate(value: string | null) {
  if (!value) return "Sin fecha";
  const key = value.slice(0, 10);
  const [year, month, day] = key.split("-");
  return year && month && day ? `${day}/${month}/${year}` : key;
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "—";
}

function planDisplay(value: string) {
  const match = value.trim().match(/^(.*?)(?:\s*\(SKU\s*([^)]+)\))$/i);
  return match
    ? { name: String(match[1] || "Plan").trim(), sku: String(match[2] || "").trim() }
    : { name: value || "Plan", sku: "" };
}

export function DashboardSubscriptionsTable({ board }: { board: SubscriptionsBoard }) {
  const rows = board.rows.slice(0, 8);

  return (
    <section className="dashboard-subscriptions" aria-labelledby="dashboard-subscriptions-title">
      <div className="dashboard-subscriptions-head">
        <div>
          <h2 id="dashboard-subscriptions-title">Suscripciones</h2>
          <p>Estado del ciclo vigente y próximas acciones de cobro.</p>
        </div>
        <Link href="/billing?vista=lista" prefetch={false} className="ghost btn-compact btn-noicon">
          Ver todas
        </Link>
      </div>

      <div className="billing-list dashboard-subscriptions-list">
        <div className="billing-list-header">
          <span>Cliente</span>
          <span>Plan</span>
          <span>Ciclo</span>
          <span>Próximo cobro</span>
          <span>Estado</span>
          <span>Método</span>
          <span>Acción</span>
        </div>
        {rows.map((row) => {
          const tone = row.delinquency === "EN_MORA" ? "pill-bad" : row.delinquency === "EN_GRACIA" ? "pill-warn" : "pill-ok";
          const href = `/billing?${new URLSearchParams({ vista: "lista", q: row.customerName }).toString()}`;
          const plan = planDisplay(row.planName);
          return (
            <div className="billing-list-row" key={row.subscriptionId}>
              <div className="billing-list-cell billing-list-person">
                <span className="billing-list-avatar" aria-hidden="true">{initials(row.customerName)}</span>
                <span className="billing-list-person-copy">
                  <strong className="billing-list-name">{row.customerName}</strong>
                  <span className="billing-list-sub">{row.customerPhone || "Sin teléfono registrado"}</span>
                </span>
              </div>
              <div className="billing-list-cell billing-list-product">
                <strong className="billing-list-link">{plan.name}</strong>
                <span className="billing-list-sub">{plan.sku ? <span className="billing-list-sku">SKU {plan.sku}</span> : "Suscripción activa"}</span>
              </div>
              <div className="billing-list-cell billing-list-cycle">
                <span className="billing-list-cycle-n">{row.cycleNumber != null ? `#${row.cycleNumber}` : "—"}</span>
                <span className={`billing-list-sub ${row.cyclePaid ? "is-ok" : "is-warn"}`}>{row.cyclePaid ? "Pagado" : "Sin pagar"}</span>
              </div>
              <div className="billing-list-cell billing-list-next">
                <span>{civilDate(row.nextCharge?.at || row.cycleDueAt)}</span>
                <span className={`billing-list-sub ${row.daysPastDue > 0 ? "is-bad" : ""}`}>
                  {row.daysPastDue > 0 ? `Vencido hace ${row.daysPastDue} días` : row.nextCharge?.kind === "RETRY" ? "Reintento programado" : "Fecha de corte"}
                </span>
              </div>
              <div className="billing-list-cell billing-list-status">
                <span className={`pill pill-sm ${tone}`}>{STATE_LABEL[row.delinquency] || row.delinquency}</span>
              </div>
              <div className="billing-list-cell billing-list-method">
                <span className="billing-list-method-name">{MODE_LABEL[row.mode] || row.mode}</span>
                <span className="billing-list-sub">{row.mode === "AUTO_DEBIT" ? (row.hasCard ? "Tarjeta registrada" : "Sin tarjeta") : "Envío por link"}</span>
              </div>
              <div className="billing-list-cell billing-list-more">
                <Link href={href} prefetch={false} className="ghost btn-compact btn-noicon billing-list-detail-button">
                  Gestionar
                </Link>
              </div>
            </div>
          );
        })}
        {!rows.length ? <div className="contact-empty">No hay suscripciones activas.</div> : null}
      </div>
    </section>
  );
}
