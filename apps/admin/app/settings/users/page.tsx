import { createUser } from "./actions";
import { getCsrfToken } from "../../lib/csrf";
import { normalizeErrorParam } from "../../lib/errorParam";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";
import { listAdminUsers } from "../../admin/_services/adminUsers";
import { listTenants } from "../../admin/_services/tenants";

export default async function SettingsUsersPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; created?: string }>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const error = normalizeErrorParam(sp.error);
  const created = String(sp.created || "").trim() === "1";

  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const usersRes = await listAdminUsers(session);
  const users: any[] = usersRes.ok ? usersRes.items || [] : [];
  const tenants = (await listTenants()).filter((t: any) => t?.active !== false);
  const isSuperAdmin = session?.role === "SUPER_ADMIN";
  const defaultTenantId = String(session?.tenantId || "").trim();

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {created ? <div className="card cardPad">Usuario creado exitosamente.</div> : null}
      {error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          Error: {error}
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <h3 style={{ display: "flex", gap: 10, alignItems: "center" }}>
              Gestión de Usuarios
              <span className="pill">{users.length}</span>
            </h3>
            <p className="subtitle">Crea y administra los accesos para tu empresa.</p>
          </div>
        </div>
        
        <div className="settings-group-body">
          {!usersRes.ok && (
            <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
              Error cargando usuarios: {usersRes.error}
            </div>
          )}

          <div className="panel module">
            <h4 style={{ marginBottom: 12 }}>Nuevo Usuario</h4>
            <form action={createUser} style={{ display: "grid", gap: 16 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              
              <div className="field">
                <label>Correo Electrónico</label>
                <input name="email" className="input" placeholder="usuario@empresa.com" autoComplete="off" required />
              </div>

              <div className="field">
                <label>Contraseña</label>
                <input name="password" className="input" type="password" autoComplete="new-password" required />
                <div className="field-hint">Mínimo 8 caracteres.</div>
              </div>

              <div className="field">
                <label>Rol de Usuario</label>
                <select className="select" name="role" defaultValue="AGENT">
                  <option value="ADMIN">Administrador (Acceso total)</option>
                  <option value="AGENT">Asesor (Solo consultas y operaciones)</option>
                </select>
                <div className="field-hint">Los asesores no pueden ver la configuración ni gestionar usuarios.</div>
              </div>

              <div className="field">
                <label>Canales / Tenants</label>
                {isSuperAdmin ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {(tenants || []).map((t: any) => (
                      <label key={t.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          name="tenantIds"
                          value={t.id}
                          defaultChecked={Boolean(defaultTenantId && String(t.id) === defaultTenantId)}
                        />
                        <span>{t.name}</span>
                      </label>
                    ))}
                    {!tenants.length ? <div className="field-hint">No hay tenants activos.</div> : null}
                  </div>
                ) : (
                  <div className="field-hint">
                    {defaultTenantId
                      ? `Asignado a: ${(tenants || []).find((t: any) => String(t.id) === defaultTenantId)?.name || "Tenant actual"}`
                      : "No hay tenant asociado a tu sesión."}
                    {defaultTenantId ? <input type="hidden" name="tenantIds" value={defaultTenantId} /> : null}
                  </div>
                )}
              </div>

              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input name="active" value="1" type="checkbox" defaultChecked />
                <span>Usuario Activo</span>
              </label>

              <button className="primary" type="submit" style={{ justifySelf: "start" }}>
                Crear Usuario
              </button>
            </form>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
            <h4 style={{ marginBottom: 4 }}>Usuarios Existentes</h4>
            {users.map((u) => (
              <div key={u.id}>
                <div className="card cardPad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontWeight: 700 }}>{u.email}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      Creado el {new Date(u.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className={`pill ${u.role === "ADMIN" ? "pillPrimary" : ""}`}>{u.role}</span>
                    <span className={`pill ${u.active ? "" : "pillDanger"}`}>{u.active ? "Activo" : "Inactivo"}</span>
                  </div>
                </div>
                {u?.tenantNames?.length ? (
                  <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
                    Canales: {u.tenantNames.join(", ")}
                  </div>
                ) : null}
              </div>
            ))}
            {!users.length ? <div className="card cardPad">No hay usuarios registrados.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
