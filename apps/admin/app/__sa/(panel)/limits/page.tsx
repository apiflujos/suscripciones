import { saAdminFetch } from "../../saApi";
import { upsertLimit } from "./actions";

export default async function SaLimitsPage({ searchParams }: { searchParams?: { error?: string } }) {
  const error = String(searchParams?.error || "").trim();

  const limitsRes = await saAdminFetch("/admin/sa/limits", { method: "GET" });
  const items: any[] = limitsRes.ok ? limitsRes.json?.items || [] : [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3 style={{ display: "flex", gap: 10, alignItems: "center" }}>
            Catálogo de servicios
            <span className="pill">{items.length}</span>
          </h3>
        </div>
        <div className="settings-group-body">
          <form action={upsertLimit} className="panel module" style={{ display: "grid", gap: 10 }}>
            <div className="field">
              <label>Key</label>
              <input name="key" className="input" placeholder="ej: api_calls" />
            </div>
            <div className="field">
              <label>Nombre</label>
              <input name="name" className="input" placeholder="API Calls" />
            </div>
            <div className="field">
              <label>Periodo</label>
              <select name="periodType" className="select" defaultValue="monthly">
                <option value="monthly">Mensual (YYYY-MM)</option>
                <option value="total">Total (acumulado)</option>
              </select>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input name="active" value="1" type="checkbox" defaultChecked />
              <span>Activo</span>
            </label>
            <button className="primary" type="submit">
              Guardar servicio
            </button>
            <div className="field-hint">Cambiar el catálogo no requiere código: todo se mide por service key.</div>
          </form>

          {!limitsRes.ok ? (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error cargando servicios: {limitsRes.json?.error || `HTTP ${limitsRes.status}`}
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 10 }}>
            {items.map((d) => (
              <div key={d.key} className="card cardPad" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontWeight: 900 }}>{d.name}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    <code>{d.key}</code> · {d.periodType}
                  </div>
                </div>
                <span className={`pill ${d.active ? "" : "pillDanger"}`}>{d.active ? "Activo" : "Inactivo"}</span>
              </div>
            ))}
            {!items.length ? <div className="card cardPad">No hay servicios todavía.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

