import { saAdminFetch } from "../../saApi";
import { createUser } from "./actions";

export default async function SaUsersPage({
  searchParams
}: {
  searchParams?: { tenantId?: string; error?: string; created?: string };
}) {
  const error = String(searchParams?.error || "").trim();
  const tenantId = String(searchParams?.tenantId || "").trim();
  const created = String(searchParams?.created || "").trim() === "1";

  const tenantsRes = await saAdminFetch("/admin/sa/tenants", { method: "GET" });
  const qp = new URLSearchParams();
  if (tenantId) qp.set("tenantId", tenantId);
  const usersRes = await saAdminFetch(`/admin/sa/users${qp.toString() ? `?${qp.toString()}` : ""}`, { method: "GET" });

  const tenants: any[] = tenantsRes.ok ? tenantsRes.json?.items || [] : [];
  const users: any[] = usersRes.ok ? usersRes.json?.items || [] : [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {created ? <div className="card cardPad">Usuario creado.</div> : null}
      {error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <h3 style={{ display: "flex", gap: 10, alignItems: "center" }}>
            Usuarios
            <span className="pill">{users.length}</span>
          </h3>
        </div>
        <div className="settings-group-body">
          {(!tenantsRes.ok || !usersRes.ok) && (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error cargando datos: tenants {tenantsRes.ok ? "ok" : tenantsRes.status} / users {usersRes.ok ? "ok" : usersRes.status}
            </div>
          )}

          <div className="panel module" style={{ display: "grid", gap: 10 }}>
            <form method="get" className="field" style={{ margin: 0, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
              <div style={{ minWidth: 260 }}>
                <label>Tenant (filtro)</label>
                <select className="select" name="tenantId" defaultValue={tenantId}>
                  <option value="">Todos</option>
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

          <form action={createUser} className="panel module" style={{ display: "grid", gap: 10 }}>
            <div className="field">
              <label>Tenant</label>
              <select className="select" name="tenantId" defaultValue={tenantId || ""} required>
                <option value="" disabled>
                  Selecciona…
                </option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Email</label>
              <input name="email" className="input" placeholder="usuario@empresa.com" autoComplete="off" required />
            </div>

            <div className="field">
              <label>Password</label>
              <input name="password" className="input" type="password" autoComplete="new-password" required />
              <div className="field-hint">Mínimo 8 caracteres.</div>
            </div>

            <div className="field">
              <label>Rol</label>
              <select className="select" name="role" defaultValue="AGENT">
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input name="active" value="1" type="checkbox" defaultChecked />
              <span>Activo</span>
            </label>

            <button className="primary" type="submit">
              Crear usuario
            </button>
          </form>

          <div style={{ display: "grid", gap: 10 }}>
            {users.map((u) => (
              <div key={u.id} className="card cardPad" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontWeight: 900 }}>{u.email}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    <code>{u.id}</code>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="pill">{u.role}</span>
                  <span className={`pill ${u.active ? "" : "pillDanger"}`}>{u.active ? "Activo" : "Inactivo"}</span>
                </div>
              </div>
            ))}
            {!users.length ? <div className="card cardPad">No hay usuarios.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

