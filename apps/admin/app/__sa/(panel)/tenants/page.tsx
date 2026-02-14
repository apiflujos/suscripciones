import Link from "next/link";
import { saAdminFetch } from "../../saApi";
import { assignPlan, createTenant, setTenantActive } from "./actions";
import { getCsrfToken } from "../../../lib/csrf";

export default async function SaTenantsPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; saved?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const error = String(sp.error || "").trim();

  const tenantsRes = await saAdminFetch("/admin/sa/tenants", { method: "GET" });
  const plansRes = await saAdminFetch("/admin/sa/plans", { method: "GET" });

  const tenants: any[] = tenantsRes.ok ? tenantsRes.json?.items || [] : [];
  const plans: any[] = plansRes.ok ? plansRes.json?.items || [] : [];

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
            Tenants
            <span className="pill">{tenants.length}</span>
          </h3>
        </div>
        <div className="settings-group-body">
          <form action={createTenant} className="panel module" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            <div className="field" style={{ margin: 0, minWidth: 260 }}>
              <label>Nuevo tenant</label>
              <input name="name" className="input" placeholder="Nombre del tenant" />
            </div>
            <button className="primary" type="submit">
              Crear
            </button>
          </form>

          {(!tenantsRes.ok || !plansRes.ok) && (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error cargando datos: tenants {tenantsRes.ok ? "ok" : tenantsRes.status} / planes {plansRes.ok ? "ok" : plansRes.status}
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {tenants.map((t) => (
              <div key={t.id} className="card cardPad" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontWeight: 900 }}>{t.name}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      <code>{t.id}</code>
                    </div>
                  </div>
                  <span className={`pill ${t.active ? "" : "pillDanger"}`}>{t.active ? "Activo" : "Inactivo"}</span>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
                  <form action={setTenantActive} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="tenantId" value={t.id} />
                    <input type="hidden" name="active" value={t.active ? "0" : "1"} />
                    <button type="submit" className="ghost">
                      {t.active ? "Desactivar" : "Activar"}
                    </button>
                  </form>

                  <form action={assignPlan} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="tenantId" value={t.id} />
                    <div className="field" style={{ margin: 0, minWidth: 260 }}>
                      <label>Asignar plan</label>
                      <select name="planId" className="select" defaultValue="">
                        <option value="" disabled>
                          Selecciona…
                        </option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.kind})
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" className="primary">
                      Asignar
                    </button>
                  </form>

                  <Link className="btn" href={`/sa/usage?tenantId=${encodeURIComponent(t.id)}`} prefetch={false}>
                    Ver consumos
                  </Link>
                </div>
              </div>
            ))}

            {!tenants.length ? <div className="card cardPad">No hay tenants todavía.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
