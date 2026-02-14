import { saAdminFetch } from "../../saApi";
import { setTenantModule, upsertModule } from "./actions";
import { getCsrfToken } from "../../../lib/csrf";

export default async function SaModulesPage({
  searchParams
}: {
  searchParams?: Promise<{ tenantId?: string; error?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const error = String(sp.error || "").trim();
  const tenantId = String(sp.tenantId || "").trim();

  const tenantsRes = await saAdminFetch("/admin/sa/tenants", { method: "GET" });
  const modulesRes = await saAdminFetch("/admin/sa/modules", { method: "GET" });

  const tenants: any[] = tenantsRes.ok ? tenantsRes.json?.items || [] : [];
  const modules: any[] = modulesRes.ok ? modulesRes.json?.items || [] : [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3>Módulos</h3>
        </div>
        <div className="settings-group-body">
          <form action={upsertModule} className="panel module" style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            <div className="field">
              <label>Key</label>
              <input name="key" className="input" placeholder="ej: billing" />
            </div>
            <div className="field">
              <label>Nombre</label>
              <input name="name" className="input" placeholder="Cobranza" />
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input name="active" value="1" type="checkbox" defaultChecked />
              <span>Activo globalmente</span>
            </label>
            <button className="primary" type="submit">
              Guardar módulo
            </button>
            <div className="field-hint">Tip: si un módulo está inactivo, no permite consumo (aunque exista el tenant toggle).</div>
          </form>

          <div className="panel module" style={{ display: "grid", gap: 10 }}>
            <form method="get" className="field" style={{ margin: 0, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
              <div style={{ minWidth: 260 }}>
                <label>Tenant (para toggles)</label>
                <select className="select" name="tenantId" defaultValue={tenantId}>
                  <option value="">Selecciona…</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <button className="primary" type="submit" style={{ height: 38 }}>
                Ver
              </button>
            </form>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {modules.map((m) => (
              <div key={m.key} className="card cardPad" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontWeight: 900 }}>{m.name}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      <code>{m.key}</code>
                    </div>
                  </div>
                  <span className={`pill ${m.active ? "" : "pillDanger"}`}>{m.active ? "Global ON" : "Global OFF"}</span>
                </div>

                {tenantId ? (
                  <form action={setTenantModule} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="moduleKey" value={m.key} />
                    <button className="ghost" name="enabled" value="1" type="submit">
                      Enable (tenant)
                    </button>
                    <button className="ghost" name="enabled" value="0" type="submit">
                      Disable (tenant)
                    </button>
                    <div className="field-hint">Si está Disabled, el consumo se bloquea para este módulo.</div>
                  </form>
                ) : (
                  <div className="field-hint">Selecciona un tenant para habilitar/deshabilitar por tenant.</div>
                )}
              </div>
            ))}
            {!modules.length ? <div className="card cardPad">No hay módulos todavía.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
