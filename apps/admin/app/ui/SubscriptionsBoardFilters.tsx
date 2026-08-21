import Link from "next/link";

export type BoardFilters = {
  mode: string;
  state: string;
  notified: string;
  q: string;
};

const MODE_OPTIONS = [
  { id: "", label: "Todos los modos" },
  { id: "AUTO_DEBIT", label: "Débito automático" },
  { id: "AUTO_LINK", label: "Link de pago" },
  { id: "MANUAL_LINK", label: "Cobro manual" }
];

const STATE_OPTIONS = [
  { id: "", label: "Todos" },
  { id: "AL_DIA", label: "Al día" },
  { id: "EN_GRACIA", label: "En gracia" },
  { id: "EN_MORA", label: "En mora" }
];

const NOTIFIED_OPTIONS = [
  { id: "", label: "Todos" },
  { id: "no", label: "Sin avisar" },
  { id: "failed", label: "Aviso falló" }
];

function Chips({
  options,
  active,
  param,
  base
}: {
  options: { id: string; label: string }[];
  active: string;
  param: string;
  base: URLSearchParams;
}) {
  return (
    <div className="sb-chips">
      {options.map((opt) => {
        const params = new URLSearchParams(base);
        if (opt.id) params.set(param, opt.id);
        else params.delete(param);
        return (
          <Link
            key={opt.id || "all"}
            href={`/?${params.toString()}`}
            prefetch={false}
            className={`sb-chip${active === opt.id ? " is-active" : ""}`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

export function SubscriptionsBoardFilters({
  filters,
  base,
  exportHref,
  shown,
  total
}: {
  filters: BoardFilters;
  base: URLSearchParams;
  exportHref: string;
  shown: number;
  total: number;
}) {
  const hasFilter = Boolean(filters.mode || filters.state || filters.notified || filters.q);
  const clear = new URLSearchParams(base);
  ["mode", "state", "notified", "q"].forEach((k) => clear.delete(k));

  return (
    <div className="sb-filters">
      <form className="sb-search" action="/" method="get">
        {Array.from(base.entries())
          .filter(([k]) => k !== "q")
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Buscar cliente, plan o teléfono…"
          aria-label="Buscar suscripción"
        />
        <button type="submit" className="ghost btn-compact">Buscar</button>
      </form>

      <Chips options={MODE_OPTIONS} active={filters.mode} param="mode" base={base} />
      <Chips options={STATE_OPTIONS} active={filters.state} param="state" base={base} />
      <Chips options={NOTIFIED_OPTIONS} active={filters.notified} param="notified" base={base} />

      <div className="sb-filters-foot">
        <span className="muted">
          {shown === total ? `${total} suscripciones` : `${shown} de ${total} suscripciones`}
        </span>
        {hasFilter ? (
          <Link href={`/?${clear.toString()}`} prefetch={false} className="ghost btn-compact">
            Quitar filtros
          </Link>
        ) : null}
        <a className="ghost btn-compact btn-noicon btn-export" href={exportHref} data-loader="off">
          Descargar Excel
        </a>
      </div>
    </div>
  );
}
